/**
 * A small Markdown reader for the chat, the Docs tab, Skills and Drafts:
 * headings, paragraphs, lists (nested), tables, code blocks, quotes, rules,
 * and inline code, bold, italic and links. It returns a tree; the `Markdown`
 * component in `components/markdown.tsx` draws it. It never produces HTML,
 * so nothing a model or a document writes can inject markup, and a link is
 * kept only when its address is plainly safe.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "break" };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; lang: string | null; text: string }
  | { type: "quote"; children: Block[] }
  | { type: "rule" }
  | {
      type: "list";
      ordered: boolean;
      /** The number an ordered list starts at. */
      start: number;
      items: Block[][];
    }
  | { type: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] };

// Inline -----------------------------------------------------------------------

/** An address a link may carry: http(s), mailto, or a path or anchor on this site. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || /[\s<>"]/.test(href)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  if (/^\/(?!\/)/.test(href) || href.startsWith("#")) return href;
  return null;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|<>~]/;
const WORD = /[\p{L}\p{N}]/u;

/** The index after a code span that opens at `from`, or -1 when it never closes. */
function codeSpanEnd(text: string, from: number): number {
  let ticks = 0;
  while (text[from + ticks] === "`") ticks++;
  const fence = "`".repeat(ticks);
  let at = from + ticks;
  for (;;) {
    const close = text.indexOf(fence, at);
    if (close === -1) return -1;
    let run = ticks;
    while (text[close + run] === "`") run++;
    // A longer run of ticks is not the closing one.
    if (run === ticks) return close + ticks;
    at = close + run;
  }
}

/**
 * Where `delimiter` next closes after `from`, skipping escapes and code
 * spans, and for a single `*` or `_` skipping doubled ones (a `**strong**`
 * inside). A closing delimiter does not follow whitespace.
 */
function findClose(text: string, from: number, delimiter: string): number {
  const single = delimiter.length === 1;
  let at = from;
  while (at < text.length) {
    const char = text[at];
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === "`") {
      const end = codeSpanEnd(text, at);
      at = end === -1 ? at + 1 : end;
      continue;
    }
    if (text.startsWith(delimiter, at)) {
      if (single && text[at + 1] === delimiter) {
        // A doubled delimiter: step over the strong span it opens, if it closes.
        const inner = text.indexOf(delimiter + delimiter, at + 2);
        at = inner === -1 ? at + 2 : inner + 2;
        continue;
      }
      if (at > from && !/\s/.test(text[at - 1] ?? "")) {
        let close = at;
        // `***both***`: let the strong span keep the inner `*…*`.
        while (!single && text[close + delimiter.length] === delimiter[0])
          close++;
        return close;
      }
    }
    at++;
  }
  return -1;
}

/** `[label](address)` opening at `from`: its label, address and end, or null. */
function linkAt(text: string, from: number) {
  let depth = 0;
  let labelEnd = -1;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === "\\") {
      at++;
    } else if (char === "`") {
      const end = codeSpanEnd(text, at);
      if (end !== -1) at = end - 1;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) {
        labelEnd = at;
        break;
      }
    }
  }
  if (labelEnd === -1 || text[labelEnd + 1] !== "(") return null;
  let parens = 0;
  for (let at = labelEnd + 1; at < text.length; at++) {
    const char = text[at];
    if (char === "\n") return null;
    if (char === "(") parens++;
    else if (char === ")") {
      parens--;
      if (parens === 0) {
        const inside = text.slice(labelEnd + 2, at).trim();
        // Drop an optional title: (address "title").
        const address = inside.replace(/\s+("[^"]*"|'[^']*')$/, "");
        return {
          label: text.slice(from + 1, labelEnd),
          address: address.replace(/^<(.*)>$/, "$1"),
          end: at + 1,
        };
      }
    }
  }
  return null;
}

/** A bare `https://…` address starting at `from`, without the punctuation that ends a sentence. */
function bareUrlAt(text: string, from: number): string | null {
  const match = /^https?:\/\/[^\s<>`]+/i.exec(text.slice(from));
  if (!match) return null;
  let url = match[0];
  for (;;) {
    const last = url.at(-1) ?? "";
    if (/[.,;:!?'"*_]/.test(last)) {
      url = url.slice(0, -1);
    } else if (
      last === ")" &&
      url.split("(").length - 1 < url.split(")").length - 1
    ) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return url.length > "https://".length ? url : null;
}

/** Reads one block's text into inline pieces. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    const last = out.at(-1);
    if (last?.type === "text") last.text += buffer;
    else out.push({ type: "text", text: buffer });
    buffer = "";
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? "";
    const next = text[at + 1] ?? "";

    if (char === "\\") {
      if (next === "\n") {
        flush();
        out.push({ type: "break" });
        at += 2;
        continue;
      }
      if (ESCAPABLE.test(next)) {
        buffer += next;
        at += 2;
        continue;
      }
    }

    if (char === "\n") {
      if (/ {2,}$/.test(buffer)) {
        buffer = buffer.replace(/ +$/, "");
        flush();
        out.push({ type: "break" });
      } else {
        buffer = `${buffer.replace(/ +$/, "")} `;
      }
      at++;
      while (text[at] === " ") at++;
      continue;
    }

    if (char === "`") {
      const end = codeSpanEnd(text, at);
      if (end !== -1) {
        let ticks = 0;
        while (text[at + ticks] === "`") ticks++;
        let code = text.slice(at + ticks, end - ticks).replace(/\n/g, " ");
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        flush();
        out.push({ type: "code", text: code });
        at = end;
        continue;
      }
    }

    if (char === "[") {
      const link = linkAt(text, at);
      const href = link ? safeHref(link.address) : null;
      if (link && href) {
        flush();
        out.push({ type: "link", href, children: parseInline(link.label) });
        at = link.end;
        continue;
      }
      if (link) {
        // An address that is not safe: keep the words, drop the link.
        flush();
        out.push(...parseInline(link.label));
        at = link.end;
        continue;
      }
    }

    if (char === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(at));
      const href = auto?.[1] ? safeHref(auto[1]) : null;
      if (auto && href) {
        flush();
        out.push({
          type: "link",
          href,
          children: [{ type: "text", text: href.replace(/^mailto:/i, "") }],
        });
        at += auto[0].length;
        continue;
      }
    }

    if (
      (char === "h" || char === "H") &&
      !WORD.test(text[at - 1] ?? "") &&
      /^https?:\/\//i.test(text.slice(at, at + 8))
    ) {
      const url = bareUrlAt(text, at);
      if (url) {
        flush();
        out.push({
          type: "link",
          href: url,
          children: [{ type: "text", text: url }],
        });
        at += url.length;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      // `snake_case` is not emphasis: an underscore inside a word is text.
      const opens =
        !/\s/.test(next) &&
        next !== "" &&
        (char === "*" || !WORD.test(text[at - 1] ?? ""));
      const double = next === char;
      if (opens && double && !/\s/.test(text[at + 2] ?? " ")) {
        const close = findClose(text, at + 2, char + char);
        const after = text[close + 2] ?? "";
        if (close !== -1 && (char === "*" || !WORD.test(after))) {
          flush();
          out.push({
            type: "strong",
            children: parseInline(text.slice(at + 2, close)),
          });
          at = close + 2;
          continue;
        }
      }
      if (opens && !double) {
        const close = findClose(text, at + 1, char);
        const after = text[close + 1] ?? "";
        if (close !== -1 && (char === "*" || !WORD.test(after))) {
          flush();
          out.push({
            type: "em",
            children: parseInline(text.slice(at + 1, close)),
          });
          at = close + 1;
          continue;
        }
      }
      if (double) {
        buffer += char + char;
        at += 2;
        continue;
      }
    }

    buffer += char;
    at++;
  }
  flush();
  return out;
}

/** The words of some inline pieces, markup dropped: for a heading's anchor or a preview. */
export function inlineText(inlines: Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
        case "code":
          return inline.text;
        case "break":
          return " ";
        default:
          return inlineText(inline.children);
      }
    })
    .join("");
}

// Blocks -----------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*)|\s*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (line: string) => /^\s*/.exec(line)?.[0].length ?? 0;

/** A table row's cells: split on `|` that is not escaped or inside code. */
function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const text = line.trim();
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? "";
    if (char === "\\" && text[at + 1] === "|") {
      cell += "|";
      at++;
    } else if (char === "`") {
      const end = codeSpanEnd(text, at);
      const stop = end === -1 ? at + 1 : end;
      cell += text.slice(at, stop);
      at = stop - 1;
    } else if (char === "|") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  if (text.startsWith("|")) cells.shift();
  if (text.endsWith("|") && !text.endsWith("\\|")) cells.pop();
  return cells.map((item) => item.trim());
}

function isTableStart(lines: string[], at: number): boolean {
  const head = lines[at] ?? "";
  const rule = lines[at + 1] ?? "";
  return (
    head.includes("|") &&
    rule.includes("-") &&
    TABLE_RULE.test(rule) &&
    cellsOf(head).length === cellsOf(rule).length
  );
}

/** Whether a line starts a block that may cut a paragraph short. */
function interrupts(lines: string[], at: number): boolean {
  const line = lines[at] ?? "";
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line)) return true;
  if (QUOTE.test(line)) return true;
  const item = ITEM.exec(line);
  if (item && item[3] !== undefined) {
    // "1986. A great year" should not start a list in the middle of a paragraph.
    const marker = item[2] ?? "";
    return /^[-*+]$/.test(marker) || /^1[.)]$/.test(marker);
  }
  return isTableStart(lines, at);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    if (!line.trim()) {
      at++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const indent = indentOf(line);
      const body: string[] = [];
      at++;
      while (at < lines.length) {
        const inner = lines[at] ?? "";
        const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
        if (close.test(inner)) {
          at++;
          break;
        }
        body.push(inner.slice(Math.min(indent, indentOf(inner))));
        at++;
      }
      blocks.push({
        type: "code",
        lang: fence[2] || null,
        text: body.join("\n"),
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: (heading[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2] ?? ""),
      });
      at++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      at++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (at < lines.length) {
        const quoted = QUOTE.exec(lines[at] ?? "");
        if (quoted) inner.push(quoted[1] ?? "");
        // A line without `>` right after a quoted one carries the quote on.
        else if ((lines[at] ?? "").trim() && !interrupts(lines, at)) {
          inner.push(lines[at] ?? "");
        } else break;
        at++;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner) });
      continue;
    }

    if (isTableStart(lines, at)) {
      const head = cellsOf(line).map(parseInline);
      const align = cellsOf(lines[at + 1] ?? "").map((cell): Align => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right
          ? "center"
          : right
            ? "right"
            : left
              ? "left"
              : null;
      });
      at += 2;
      const rows: Inline[][][] = [];
      while (
        at < lines.length &&
        (lines[at] ?? "").trim() &&
        (lines[at] ?? "").includes("|")
      ) {
        const cells = cellsOf(lines[at] ?? "");
        // Every row has the header's width: short rows are padded, long ones cut.
        rows.push(head.map((_, index) => parseInline(cells[index] ?? "")));
        at++;
      }
      blocks.push({ type: "table", align, head, rows });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const [list, next] = parseList(lines, at);
      blocks.push(list);
      at = next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    at++;
    while (
      at < lines.length &&
      (lines[at] ?? "").trim() &&
      !interrupts(lines, at)
    ) {
      // Keep trailing spaces: two of them before a newline are a line break.
      paragraph.push((lines[at] ?? "").trimStart());
      at++;
    }
    blocks.push({
      type: "paragraph",
      children: parseInline(paragraph.join("\n").trimEnd()),
    });
  }
  return blocks;
}

/** Reads the list that starts at `from`; returns it and the index after it. */
function parseList(lines: string[], from: number): [Block, number] {
  const first = ITEM.exec(lines[from] ?? "");
  const baseIndent = (first?.[1] ?? "").length;
  const ordered = /\d/.test(first?.[2] ?? "");
  const start = ordered ? Number.parseInt(first?.[2] ?? "1", 10) : 1;
  const items: Block[][] = [];
  let at = from;

  while (at < lines.length) {
    const opening = ITEM.exec(lines[at] ?? "");
    if (
      !opening ||
      (opening[1] ?? "").length !== baseIndent ||
      /\d/.test(opening[2] ?? "") !== ordered
    ) {
      break;
    }
    // Text under an item lines up after its marker: "- " is 2, "10. " is 4.
    const contentIndent = baseIndent + (opening[2] ?? "").length + 1;
    const body: string[] = [opening[3] ?? ""];
    at++;
    while (at < lines.length) {
      const line = lines[at] ?? "";
      if (!line.trim()) {
        // A blank line stays in the item only if indented text follows it.
        let ahead = at + 1;
        while (ahead < lines.length && !(lines[ahead] ?? "").trim()) ahead++;
        if (ahead < lines.length && indentOf(lines[ahead] ?? "") > baseIndent) {
          body.push("");
          at++;
          continue;
        }
        break;
      }
      const indent = indentOf(line);
      if (indent > baseIndent) {
        body.push(line.slice(Math.min(indent, contentIndent)));
        at++;
        continue;
      }
      // Not indented: a new item, a new block, or the paragraph running on.
      if (ITEM.test(line) || interrupts(lines, at)) break;
      if (!(body.at(-1) ?? "").trim()) break;
      body.push(line.trim());
      at++;
    }
    items.push(parseBlocks(body));
    // Blank lines between items do not end the list.
    let ahead = at;
    while (ahead < lines.length && !(lines[ahead] ?? "").trim()) ahead++;
    const following = ITEM.exec(lines[ahead] ?? "");
    if (
      ahead > at &&
      following &&
      (following[1] ?? "").length === baseIndent &&
      /\d/.test(following[2] ?? "") === ordered
    ) {
      at = ahead;
    }
  }
  return [{ type: "list", ordered, start, items }, at];
}

/** Reads Markdown into blocks. Never throws: text it does not understand stays text. */
export function parseMarkdown(source: string): Block[] {
  return parseBlocks(
    source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"),
  );
}

/** A heading's anchor: lowercase words joined by hyphens. */
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export type Heading = { level: number; text: string; slug: string };

/** The headings of a document in order, with unique anchors, for a table of contents. */
export function headingsOf(blocks: Block[]): Heading[] {
  const seen = new Map<string, number>();
  const headings: Heading[] = [];
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    const text = inlineText(block.children);
    const base = slugOf(text) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headings.push({
      level: block.level,
      text,
      slug: count === 0 ? base : `${base}-${count + 1}`,
    });
  }
  return headings;
}
