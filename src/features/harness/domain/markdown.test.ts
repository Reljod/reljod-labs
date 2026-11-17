import { describe, expect, it } from "vitest";
import {
  type Block,
  headingsOf,
  type Inline,
  inlineText,
  parseInline,
  parseMarkdown,
  safeHref,
} from "./markdown";

const t = (text: string): Inline => ({ type: "text", text });
const p = (...children: Inline[]): Block => ({ type: "paragraph", children });

describe("parseInline", () => {
  it("reads bold, italic and inline code", () => {
    expect(parseInline("a **b** *c* `d` e")).toEqual([
      t("a "),
      { type: "strong", children: [t("b")] },
      t(" "),
      { type: "em", children: [t("c")] },
      t(" "),
      { type: "code", text: "d" },
      t(" e"),
    ]);
  });

  it("nests emphasis", () => {
    expect(parseInline("*a **b** c*")).toEqual([
      {
        type: "em",
        children: [t("a "), { type: "strong", children: [t("b")] }, t(" c")],
      },
    ]);
    expect(parseInline("***both***")).toEqual([
      { type: "strong", children: [{ type: "em", children: [t("both")] }] },
    ]);
    expect(parseInline("__a__ and _b_")).toEqual([
      { type: "strong", children: [t("a")] },
      t(" and "),
      { type: "em", children: [t("b")] },
    ]);
  });

  it("leaves snake_case, lone stars and arithmetic alone", () => {
    expect(parseInline("run member_request then delinquency_report")).toEqual([
      t("run member_request then delinquency_report"),
    ]);
    expect(parseInline("5 * 3 * 2")).toEqual([t("5 * 3 * 2")]);
    expect(parseInline("a ** b")).toEqual([t("a ** b")]);
    expect(parseInline("**open")).toEqual([t("**open")]);
    expect(parseInline("*open")).toEqual([t("*open")]);
  });

  it("does not read markup inside code, and keeps unclosed ticks", () => {
    expect(parseInline("`**x**` and ``a ` b``")).toEqual([
      { type: "code", text: "**x**" },
      t(" and "),
      { type: "code", text: "a ` b" },
    ]);
    expect(parseInline("a ` b")).toEqual([t("a ` b")]);
    expect(parseInline("**a `**` b**")).toEqual([
      {
        type: "strong",
        children: [t("a "), { type: "code", text: "**" }, t(" b")],
      },
    ]);
  });

  it("reads links, with formatting in the label and brackets in the address", () => {
    expect(
      parseInline('see [the **Act**](https://example.ky/act_(2021) "t").'),
    ).toEqual([
      t("see "),
      {
        type: "link",
        href: "https://example.ky/act_(2021)",
        children: [t("the "), { type: "strong", children: [t("Act")] }],
      },
      t("."),
    ]);
    expect(parseInline("[Docs](/demos/harness?tab=docs) [top](#top)")).toEqual([
      { type: "link", href: "/demos/harness?tab=docs", children: [t("Docs")] },
      t(" "),
      { type: "link", href: "#top", children: [t("top")] },
    ]);
  });

  it("drops a link whose address is not safe and keeps its words", () => {
    expect(parseInline("[click](javascript:alert(1)) now")).toEqual([
      t("click now"),
    ]);
    expect(parseInline("[x](data:text/html,hi)")).toEqual([t("x")]);
    expect(parseInline("[x](//evil.example)")).toEqual([t("x")]);
    expect(parseInline("[not a link] (x)")).toEqual([t("[not a link] (x)")]);
  });

  it("links bare and bracketed addresses, without the sentence's punctuation", () => {
    expect(
      parseInline("Go to https://example.ky/a?b=1, then <mailto:a@b.ky>."),
    ).toEqual([
      t("Go to "),
      {
        type: "link",
        href: "https://example.ky/a?b=1",
        children: [t("https://example.ky/a?b=1")],
      },
      t(", then "),
      { type: "link", href: "mailto:a@b.ky", children: [t("a@b.ky")] },
      t("."),
    ]);
    expect(parseInline("(https://example.ky/x)")).toEqual([
      t("("),
      {
        type: "link",
        href: "https://example.ky/x",
        children: [t("https://example.ky/x")],
      },
      t(")"),
    ]);
    expect(parseInline("xhttps://no")).toEqual([t("xhttps://no")]);
  });

  it("honours escapes and line breaks", () => {
    expect(parseInline("\\*not em\\* and 1\\. x")).toEqual([
      t("*not em* and 1. x"),
    ]);
    expect(parseInline("one  \ntwo\nthree\\\nfour")).toEqual([
      t("one"),
      { type: "break" },
      t("two three"),
      { type: "break" },
      t("four"),
    ]);
  });

  it("gives back the words", () => {
    expect(inlineText(parseInline("**Rule** `mr.notice` [here](/x)"))).toBe(
      "Rule mr.notice here",
    );
  });
});

describe("safeHref", () => {
  it("keeps http, https, mailto, paths and anchors only", () => {
    expect(safeHref(" https://a.ky/x ")).toBe("https://a.ky/x");
    expect(safeHref("HTTP://a.ky")).toBe("HTTP://a.ky");
    expect(safeHref("mailto:a@b.ky")).toBe("mailto:a@b.ky");
    expect(safeHref("/demos")).toBe("/demos");
    expect(safeHref("#x")).toBe("#x");
    for (const bad of [
      "javascript:x",
      "JaVaScript:x",
      "data:x",
      "//a.ky",
      "a b",
      "",
      "vbscript:x",
      "relative/path",
    ]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe("parseMarkdown", () => {
  it("reads headings and paragraphs", () => {
    expect(
      parseMarkdown(
        "# One\n\nFirst line\nsecond line.\n\n### Three ###\n####### seven",
      ),
    ).toEqual([
      { type: "heading", level: 1, children: [t("One")] },
      p(t("First line second line.")),
      { type: "heading", level: 3, children: [t("Three")] },
      p(t("####### seven")),
    ]);
  });

  it("does not treat #hashtag as a heading", () => {
    expect(parseMarkdown("#nope")).toEqual([p(t("#nope"))]);
  });

  it("reads fenced code as it is, markup and all", () => {
    expect(
      parseMarkdown("```ts\nconst a = **1**;\n\n  # not a heading\n```\nafter"),
    ).toEqual([
      {
        type: "code",
        lang: "ts",
        text: "const a = **1**;\n\n  # not a heading",
      },
      p(t("after")),
    ]);
    expect(parseMarkdown("~~~\n```\n~~~")).toEqual([
      { type: "code", lang: null, text: "```" },
    ]);
  });

  it("keeps an unclosed fence as code to the end", () => {
    expect(parseMarkdown("```\nstill code")).toEqual([
      { type: "code", lang: null, text: "still code" },
    ]);
  });

  it("reads bulleted and numbered lists", () => {
    expect(parseMarkdown("- a\n- b\n\n3. c\n4. d")).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [[p(t("a"))], [p(t("b"))]],
      },
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [[p(t("c"))], [p(t("d"))]],
      },
    ]);
  });

  it("nests lists and keeps an item's later paragraphs and code", () => {
    const blocks = parseMarkdown(
      [
        "1. First",
        "   - inner a",
        "   - inner b",
        "",
        "   Still the first item.",
        "",
        "   ```",
        "   code",
        "   ```",
        "2. Second",
        "runs on",
        "",
        "After.",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: true,
        start: 1,
        items: [
          [
            p(t("First")),
            {
              type: "list",
              ordered: false,
              start: 1,
              items: [[p(t("inner a"))], [p(t("inner b"))]],
            },
            p(t("Still the first item.")),
            { type: "code", lang: null, text: "code" },
          ],
          [p(t("Second runs on"))],
        ],
      },
      p(t("After.")),
    ]);
  });

  it("keeps items apart by blank lines in one list", () => {
    expect(parseMarkdown("- a\n\n- b")).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [[p(t("a"))], [p(t("b"))]],
      },
    ]);
  });

  it("does not start a numbered list in the middle of a paragraph", () => {
    expect(parseMarkdown("The Act of\n2021. It says")).toEqual([
      p(t("The Act of 2021. It says")),
    ]);
    expect(parseMarkdown("Steps:\n1. one\n2. two")).toEqual([
      p(t("Steps:")),
      {
        type: "list",
        ordered: true,
        start: 1,
        items: [[p(t("one"))], [p(t("two"))]],
      },
    ]);
  });

  it("reads tables with alignment, inline markup and escaped pipes", () => {
    expect(
      parseMarkdown(
        "| Rule | Value | Note |\n|:--|--:|:-:|\n| `a\\|b` | **5%** | x \\| y |\n| short |\n",
      ),
    ).toEqual([
      {
        type: "table",
        align: ["left", "right", "center"],
        head: [[t("Rule")], [t("Value")], [t("Note")]],
        rows: [
          [
            [{ type: "code", text: "a\\|b" }],
            [{ type: "strong", children: [t("5%")] }],
            [t("x | y")],
          ],
          [[t("short")], [], []],
        ],
      },
    ]);
  });

  it("needs a rule line to call something a table", () => {
    expect(parseMarkdown("a | b\nc | d")).toEqual([p(t("a | b c | d"))]);
  });

  it("reads quotes and rules", () => {
    expect(parseMarkdown("> **Note**\n> second\nlazy\n\n---\n")).toEqual([
      {
        type: "quote",
        children: [
          p({ type: "strong", children: [t("Note")] }, t(" second lazy")),
        ],
      },
      { type: "rule" },
    ]);
  });

  it("handles Windows line endings, tabs and empty input", () => {
    expect(parseMarkdown("# A\r\n\r\nb\r\n")).toEqual([
      { type: "heading", level: 1, children: [t("A")] },
      p(t("b")),
    ]);
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n \n")).toEqual([]);
  });

  it("never throws on odd input", () => {
    for (const odd of [
      "[",
      "](",
      "**",
      "`",
      "| |\n|-|",
      "- ",
      "1.",
      "> ",
      "[a](",
      "<",
      "***",
      "_ _ _",
      "```",
    ]) {
      expect(() => parseMarkdown(odd), odd).not.toThrow();
    }
  });
});

describe("headingsOf", () => {
  it("lists headings with unique anchors", () => {
    expect(
      headingsOf(
        parseMarkdown(
          "# The Rules\n## Notice period\n## Notice period\n## `code` & more",
        ),
      ),
    ).toEqual([
      { level: 1, text: "The Rules", slug: "the-rules" },
      { level: 2, text: "Notice period", slug: "notice-period" },
      { level: 2, text: "Notice period", slug: "notice-period-2" },
      { level: 2, text: "code & more", slug: "code-more" },
    ]);
  });
});
