import type { ComponentChildren } from "preact";
import { type Inline, type ListBlock, parseMarkdown } from "../logic/markdown";

function inline(nodes: Inline[]): ComponentChildren {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "strong":
        return <strong key={i}>{inline(n.c)}</strong>;
      case "em":
        return <em key={i}>{inline(n.c)}</em>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {inline(n.c)}
          </a>
        );
    }
  });
}

function list(block: ListBlock, key?: number) {
  const items = block.items.map((item, i) => (
    <li key={i}>
      {inline(item.c)}
      {item.sub && list(item.sub)}
    </li>
  ));
  return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
}

export default function Markdown({ text }: { text: string }) {
  return (
    <div class="md">
      {parseMarkdown(text).map((b, i) =>
        b.t === "list" ? (
          list(b, i)
        ) : b.t === "h" ? (
          <p key={i} class="md-h">
            {inline(b.c)}
          </p>
        ) : (
          <p key={i}>{inline(b.c)}</p>
        ),
      )}
    </div>
  );
}
