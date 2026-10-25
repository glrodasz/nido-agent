// A small Markdown subset for the assistant's replies: paragraphs, headings, nested lists,
// bold, italic, inline code and http(s) links. It builds a tree instead of HTML, so the
// reply never reaches innerHTML.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export interface ListItem {
  c: Inline[];
  sub: ListBlock | null;
}

export interface ListBlock {
  t: "list";
  ordered: boolean;
  items: ListItem[];
}

export type Block = { t: "p" | "h"; c: Inline[] } | ListBlock;

const LIST_ITEM = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/;
const BARE_URL = /^https?:\/\/[^\s<>()]+/;

const safeHref = (href: string) => (/^https?:\/\//i.test(href) ? href : null);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest[0] === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const mark = rest.slice(0, 2);
      const end = src.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (rest[0] === "*" && rest[1] && rest[1] !== " ") {
      const end = src.indexOf("*", i + 1);
      if (end > i + 1 && src[end - 1] !== " ") {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (rest[0] === "[") {
      const m = LINK.exec(rest);
      if (m) {
        flush();
        const href = safeHref(m[2]);
        const label = parseInline(m[1]);
        if (href) out.push({ t: "link", href, c: label });
        else out.push(...label);
        i += m[0].length;
        continue;
      }
    }
    if ((rest[0] === "h" || rest[0] === "H") && !/\w/.test(src[i - 1] ?? "")) {
      const m = BARE_URL.exec(rest);
      if (m) {
        // Sentence punctuation right after a URL is not part of it.
        const url = m[0].replace(/[.,;:!?]+$/, "");
        flush();
        out.push({ t: "link", href: url, c: [{ t: "text", v: url }] });
        i += url.length;
        continue;
      }
    }
    text += rest[0];
    i += 1;
  }
  flush();
  return out;
}

const indentOf = (s: string) => s.replace(/\t/g, "    ").length;

function parseList(lines: string[], start: number, indent: number): [ListBlock, number] {
  const first = LIST_ITEM.exec(lines[start])!;
  const list: ListBlock = { t: "list", ordered: /\d/.test(first[2]), items: [] };
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m) {
      const line = lines[i];
      // An indented line under an item continues that item's text.
      if (line.trim() && /^\s/.test(line) && list.items.length) {
        const item = list.items[list.items.length - 1];
        item.c.push({ t: "text", v: " " }, ...parseInline(line.trim()));
        i += 1;
        continue;
      }
      break;
    }
    const level = indentOf(m[1]);
    if (level < indent) break;
    if (level > indent && list.items.length) {
      const [sub, next] = parseList(lines, i, level);
      const item = list.items[list.items.length - 1];
      if (item.sub) item.sub.items.push(...sub.items);
      else item.sub = sub;
      i = next;
      continue;
    }
    list.items.push({ c: parseInline(m[3]), sub: null });
    i += 1;
  }
  return [list, i];
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const [list, next] = parseList(lines, i, indentOf(item[1]));
      blocks.push(list);
      i = next;
      continue;
    }
    const heading = HEADING.exec(line.trim());
    if (heading) {
      flush();
      blocks.push({ t: "h", c: parseInline(heading[1]) });
      i += 1;
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flush();
  return blocks;
}
