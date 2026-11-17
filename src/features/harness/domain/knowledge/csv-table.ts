/*
 * Reading a Source's text as tables, for the preview: CSV (RFC 4180, with
 * quoted cells, doubled quotes and line breaks inside quotes) and the
 * "## Sheet: name (N rows)" blocks a workbook is extracted as. Pure.
 */

/** The cells of a CSV text, row by row. A trailing empty line is not a row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export type SheetTable = { name: string; rows: string[][] };

const SHEET = /^## Sheet: (.*) \((\d+) rows\)$/;

/** A workbook's extracted text as one table per sheet; text with no sheet headings is one table. */
export function sheetTables(text: string): SheetTable[] {
  const lines = text.split("\n");
  const sheets: { name: string; body: string[] }[] = [];
  for (const line of lines) {
    const match = SHEET.exec(line);
    if (match) sheets.push({ name: match[1] ?? "Sheet", body: [] });
    else sheets.at(-1)?.body.push(line);
  }
  if (sheets.length === 0) return [{ name: "Sheet", rows: parseCsv(text) }];
  return sheets.map((sheet) => ({
    name: sheet.name,
    rows: parseCsv(sheet.body.join("\n").trim()),
  }));
}

export type Table = {
  /** Comment lines (`# …`) before the header, shown above the table. */
  notes: string[];
  head: string[];
  body: string[][];
  /** The widest row: every row is drawn this many cells across. */
  columns: number;
};

/**
 * Rows as a table: leading `#` comment lines (a Schedule's SPECIMEN note and
 * its Employer line) are notes, not the header; the header is the first row
 * after them, and the table is as wide as its widest row.
 */
export function tableOf(rows: readonly string[][]): Table {
  let start = 0;
  const notes: string[] = [];
  while (start < rows.length) {
    const row = rows[start] ?? [];
    if (!(row[0] ?? "").trim().startsWith("#")) break;
    // A comment may hold commas; it is one line of text again.
    notes.push(row.join(",").replace(/,+$/, "").trim());
    start++;
  }
  const [head = [], ...body] = rows.slice(start);
  const columns = Math.max(head.length, ...body.map((row) => row.length), 0);
  return { notes, head, body, columns };
}
