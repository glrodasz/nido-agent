import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("reads bold, italic and code", () => {
    expect(parseInline("**Wild** *Robot* `x`")).toEqual([
      { t: "strong", c: [{ t: "text", v: "Wild" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "Robot" }] },
      { t: "text", v: " " },
      { t: "code", v: "x" },
    ]);
  });

  it("links only http(s) targets", () => {
    expect(parseInline("[IMDb](https://imdb.com/t/1)")).toEqual([
      { t: "link", href: "https://imdb.com/t/1", c: [{ t: "text", v: "IMDb" }] },
    ]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { t: "text", v: "x" },
      { t: "text", v: ")" },
    ]);
  });

  it("links bare URLs without trailing punctuation", () => {
    expect(parseInline("See https://a.se/b.")).toEqual([
      { t: "text", v: "See " },
      { t: "link", href: "https://a.se/b", c: [{ t: "text", v: "https://a.se/b" }] },
      { t: "text", v: "." },
    ]);
  });

  it("leaves a lone asterisk as text", () => {
    expect(parseInline("5 * 3")).toEqual([{ t: "text", v: "5 * 3" }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs and nests list items", () => {
    const blocks = parseMarkdown(
      [
        "Intro line",
        "continues here.",
        "",
        "*   **The Wild Robot** (Netflix)",
        "    *   *Age:* 6+",
        "*   **Toy Story 5**",
      ].join("\n"),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ t: "p", c: [{ t: "text", v: "Intro line continues here." }] });
    const list = blocks[1];
    expect(list.t).toBe("list");
    if (list.t !== "list") return;
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(list.items[0].sub?.items[0].c[0]).toEqual({ t: "em", c: [{ t: "text", v: "Age:" }] });
    expect(list.items[1].sub).toBeNull();
  });

  it("reads ordered lists and headings", () => {
    const blocks = parseMarkdown("## Picks\n1. One\n2. Two");
    expect(blocks[0]).toEqual({ t: "h", c: [{ t: "text", v: "Picks" }] });
    expect(blocks[1]).toMatchObject({ t: "list", ordered: true });
  });
});
