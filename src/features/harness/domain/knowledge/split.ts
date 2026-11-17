import { LIMITS } from "../limits";

/**
 * Splits a Source's text into Passages (ADR 0016). Pure, so it is tested
 * without a database or a model.
 *
 * Prose is split at headings, then at paragraphs, to about `TARGET_CHARS`,
 * with a little overlap so a sentence cut at a boundary is whole in one of the
 * two. Spreadsheets and CSVs are split into row groups that each repeat the
 * header row, so a number is retrieved with its column names.
 */

export const TARGET_CHARS = 900;
export const OVERLAP_CHARS = 120;
/** No Passage is longer than this, whatever it holds (the table allows 8000). */
export const MAX_CHARS = 1400;
/** The most text of one Source that is read at all. */
export const MAX_TEXT_CHARS = 200_000;

export type DraftPassage = { heading: string | null; body: string };

export type SplitResult = {
  passages: DraftPassage[];
  /** More text or more Passages than the caps allow were left out. */
  truncated: boolean;
};

/** What a Passage is embedded as: its heading is part of its meaning. */
export function embeddingText(passage: DraftPassage): string {
  return passage.heading
    ? `${passage.heading}\n\n${passage.body}`
    : passage.body;
}

// Prose --------------------------------------------------------------------------

type Section = { heading: string | null; text: string };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const PAGE_MARK = /^\[page (\d+)\]$/i;

/** Cuts text at Markdown headings and `[page N]` marks, keeping the heading trail ("Guide › Rates"). */
export function sections(text: string): Section[] {
  const out: Section[] = [];
  const trail: string[] = [];
  let heading: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) out.push({ heading, text: body });
    lines = [];
  };
  let fenced = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const mark = fenced ? null : PAGE_MARK.exec(line.trim());
    const found = fenced ? null : HEADING.exec(line);
    if (mark) {
      flush();
      heading = `Page ${mark[1]}`;
    } else if (found) {
      flush();
      const level = (found[1] ?? "#").length;
      trail.length = Math.min(trail.length, level - 1);
      trail[level - 1] = (found[2] ?? "").trim();
      heading = trail.filter(Boolean).join(" › ").slice(0, 160) || null;
    } else {
      lines.push(line);
    }
  }
  flush();
  return out;
}

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);

/** Splits one over-long block of words at sentence ends, then at spaces, to at most `size`. */
function breakLong(block: string, size: number): string[] {
  if (block.length <= size) return [block];
  const parts: string[] = [];
  let rest = block;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const sentence = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("; "),
      window.lastIndexOf(".\n"),
    );
    const space = window.lastIndexOf(" ");
    const at =
      sentence > size * 0.4 ? sentence + 1 : space > size * 0.4 ? space : size;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** A Markdown table longer than a Passage is cut into row groups that each repeat the header and its rule line. */
function breakTable(lines: string[], size: number): string[] {
  const [head, rule, ...rows] = lines;
  if (!head || !rule || rows.length === 0)
    return breakLong(lines.join("\n"), size);
  const header = `${head}\n${rule}`;
  const groups: string[] = [];
  let current: string[] = [];
  let length = header.length;
  for (const row of rows) {
    if (current.length > 0 && length + row.length + 1 > size) {
      groups.push(`${header}\n${current.join("\n")}`);
      current = [];
      length = header.length;
    }
    current.push(row);
    length += row.length + 1;
  }
  if (current.length > 0) groups.push(`${header}\n${current.join("\n")}`);
  return groups;
}

/** Paragraph-sized blocks of a section: blank-line separated, tables and long paragraphs cut to fit. */
function blocksOf(text: string, size: number): string[] {
  const blocks: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    if (lines.length > 2 && lines.every(isTableLine)) {
      blocks.push(...breakTable(lines, size));
    } else {
      blocks.push(...breakLong(trimmed, size));
    }
  }
  return blocks;
}

/** The last `chars` of a Passage, from a word boundary: what the next Passage of the same section starts with. */
function tailOf(body: string, chars: number): string {
  if (body.length <= chars) return "";
  const tail = body.slice(-chars);
  const space = tail.indexOf(" ");
  const cut = space > 0 && space < chars / 2 ? tail.slice(space + 1) : tail;
  // A table's rows are never repeated as overlap: they carry their own header.
  return cut.includes("|") ? "" : cut.trim();
}

export function splitProse(
  text: string,
  options: { target?: number; overlap?: number } = {},
): DraftPassage[] {
  const target = options.target ?? TARGET_CHARS;
  const overlap = options.overlap ?? OVERLAP_CHARS;
  const passages: DraftPassage[] = [];
  for (const section of sections(text)) {
    let current = "";
    let previous = "";
    // True once `current` holds a block of this section, not only the overlap.
    let fresh = false;
    const flush = () => {
      const body = current.trim();
      if (!body || !fresh) return;
      passages.push({
        heading: section.heading,
        body: body.slice(0, MAX_CHARS),
      });
      previous = body;
      current = "";
      fresh = false;
    };
    for (const block of blocksOf(
      section.text,
      Math.min(target, MAX_CHARS - overlap),
    )) {
      if (current && current.length + block.length + 2 > target) {
        flush();
        const lead = tailOf(previous, overlap);
        current = lead ? `… ${lead}` : "";
      }
      current = current ? `${current}\n\n${block}` : block;
      fresh = true;
    }
    flush();
  }
  return passages;
}

// Sheets and CSV ----------------------------------------------------------------

/** Parses CSV text (RFC 4180: quotes, doubled quotes, commas and newlines inside quotes). Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

const csvCell = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const csvLine = (cells: string[]) =>
  cells.map((cell) => csvCell(cell.trim())).join(",");

/**
 * One table as row groups. Every group begins with the header row, so a
 * Passage that holds "Annual earnings,…,Employer 5%" rows still says which
 * column is which. The heading names the table and the rows the group covers.
 */
export function splitTable(
  rows: string[][],
  label: string,
  options: { target?: number } = {},
): DraftPassage[] {
  const target = options.target ?? TARGET_CHARS;
  const [headerCells, ...body] = rows;
  if (!headerCells) return [];
  const header = csvLine(headerCells);
  const room = Math.max(120, Math.min(target, MAX_CHARS - 40) - header.length);
  const passages: DraftPassage[] = [];
  let group: string[] = [];
  let used = 0;
  let first = 1;
  const flush = (last: number) => {
    if (group.length === 0) return;
    passages.push({
      heading:
        group.length === 1
          ? `${label}, row ${first}`
          : `${label}, rows ${first}-${last}`,
      body: `${header}\n${group.join("\n")}`,
    });
    group = [];
    used = 0;
  };
  body.forEach((cells, index) => {
    const line = csvLine(cells).slice(0, room);
    if (group.length > 0 && used + line.length + 1 > room) {
      flush(index);
      first = index + 1;
    }
    group.push(line);
    used += line.length + 1;
  });
  flush(body.length);
  // A header and nothing else is still worth keeping: it names what the sheet holds.
  if (passages.length === 0) passages.push({ heading: label, body: header });
  return passages;
}

const SHEET_MARK = /^##\s+Sheet:\s*(.+?)(?:\s+\(\d+ rows?\))?\s*$/;

/** Text read from a workbook: `## Sheet: name (n rows)` then the sheet as CSV, one block per sheet. */
function sheetBlocks(text: string): { label: string; csv: string }[] {
  const blocks: { label: string; csv: string }[] = [];
  let label: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (label !== null && lines.join("").trim()) {
      blocks.push({ label, csv: lines.join("\n") });
    }
    lines = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const mark = SHEET_MARK.exec(line);
    if (mark) {
      flush();
      label = (mark[1] ?? "Sheet").trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return blocks;
}

export function splitSheets(
  text: string,
  fallbackLabel = "Table",
): DraftPassage[] {
  const blocks = sheetBlocks(text);
  if (blocks.length === 0) return splitTable(parseCsv(text), fallbackLabel);
  return blocks.flatMap((block) =>
    splitTable(parseCsv(block.csv), block.label),
  );
}

// Entry point --------------------------------------------------------------------

/** Splits the text of a Source of the given kind, and applies the caps. */
export function splitSource(
  kind: "pdf" | "sheet" | "csv" | "doc" | "text" | "web",
  text: string,
  options: { label?: string; maxPassages?: number } = {},
): SplitResult {
  const maxPassages = options.maxPassages ?? LIMITS.passagesPerSource;
  const clipped = text.length > MAX_TEXT_CHARS;
  const source = clipped ? text.slice(0, MAX_TEXT_CHARS) : text;
  const all =
    kind === "sheet" || kind === "csv"
      ? splitSheets(source, options.label ?? "Table")
      : splitProse(source);
  return {
    passages: all.slice(0, maxPassages),
    truncated: clipped || all.length > maxPassages,
  };
}
