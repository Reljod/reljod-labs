/**
 * Highlighted names on a page: splitting a page's text by its marks, and
 * building the marks of a recorded replay (which has no Run on the server to
 * ask) from the replay's own names and comparison. Pure.
 */
import type {
  ComparisonRow,
  ExtractedName,
  PageMark,
  PreviewPage,
} from "../domain/contract";
import { runMarks } from "../domain/marks";

export type Segment = { text: string; mark: PageMark | null };

/**
 * The page's text cut at its marks, in order. Marks out of range or
 * overlapping an earlier one are skipped, so a bad offset can never hide or
 * repeat text.
 */
export function segments(text: string, marks: PageMark[] | null): Segment[] {
  if (!marks || marks.length === 0) return [{ text, mark: null }];
  const sorted = marks
    .filter(
      (mark) =>
        mark.start >= 0 && mark.end > mark.start && mark.end <= text.length,
    )
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Segment[] = [];
  let at = 0;
  for (const mark of sorted) {
    if (mark.start < at) continue;
    if (mark.start > at)
      out.push({ text: text.slice(at, mark.start), mark: null });
    out.push({ text: text.slice(mark.start, mark.end), mark });
    at = mark.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: null });
  return out;
}

/** Pages fetched together: the server returns at most 12 per call. */
export const CHUNK = 12;

/** The first and last page of the chunk holding `page`. */
export function chunkOf(page: number, total: number) {
  const from = Math.floor((page - 1) / CHUNK) * CHUNK + 1;
  return { from, to: Math.min(total, from + CHUNK - 1) };
}

/**
 * A replayed Run's view of a page, built in the browser (a replay has no Run
 * on the server to ask): the answer key's marks turned `found` or `missed`
 * by the comparison, and the replay's names marked where they are printed,
 * `extra` when the key lacks them.
 */
export function replayPage(
  page: PreviewPage,
  names: ExtractedName[],
  rows: ComparisonRow[],
): PreviewPage {
  const missed = new Set(
    rows.filter((row) => row.status === "missed").map((row) => row.name),
  );
  const extra = new Set(
    rows.filter((row) => row.status === "extra").map((row) => row.name),
  );
  // A found party takes the key's name, so both sides share a click target.
  const keyName = new Map<string, string>();
  for (const row of rows)
    if (row.status === "found") keyName.set(row.foundAs ?? row.name, row.name);

  const key =
    page.key?.map((mark) => ({
      ...mark,
      status: missed.has(mark.name) ? ("missed" as const) : ("found" as const),
    })) ?? null;
  const run = runMarks(page.page, page.text, names, (name) => ({
    name: keyName.get(name.canonical) ?? name.canonical,
    status: extra.has(name.canonical) ? "extra" : "found",
  }));
  return { ...page, key, run };
}
