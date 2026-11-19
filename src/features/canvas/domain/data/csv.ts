/** RFC 4180 CSV for Meridia tables: "\n" line ends, empty field for null. */
import { CATALOG, tableRows } from "./catalog";
import type { Cell } from "./types";

const NEEDS_QUOTES = /[",\n\r]/;

export function csvField(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "string") {
    return NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
  }
  return String(cell);
}

export function csvLine(cells: readonly Cell[]): string {
  let line = "";
  for (let i = 0; i < cells.length; i++) {
    if (i > 0) line += ",";
    line += csvField(cells[i]);
  }
  return `${line}\n`;
}

/** The table as CSV text in chunks of `rowsPerChunk` rows; the header opens the first chunk. */
export function* tableCsvChunks(
  name: string,
  rowsPerChunk = 10_000,
): Generator<string> {
  const table = CATALOG.find((t) => t.name === name);
  if (!table) throw new Error(`Unknown Meridia table: ${name}`);
  let chunk = csvLine(table.columns.map((c) => c.name));
  let count = 0;
  for (const row of tableRows(name)) {
    chunk += csvLine(row);
    if (++count >= rowsPerChunk) {
      yield chunk;
      chunk = "";
      count = 0;
    }
  }
  if (chunk) yield chunk;
}
