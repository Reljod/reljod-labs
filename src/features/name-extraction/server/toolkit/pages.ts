/**
 * `outline` and `read_pages`: the Analyst's two views of the Document
 * itself. Pure functions over the pages and the Sweep.
 */
import type { DocumentText } from "../../domain/contract";
import {
  type AnalystState,
  candidateStatuses,
  RUN_LIMITS,
  type SweepCandidate,
} from "./state";

const HEADING_CHARS = 70;
const MAX_HEADINGS = 80;

function firstLine(text: string) {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  ).slice(0, HEADING_CHARS);
}

/** Runs of equal values as ranges: [[from, to, value], …]. */
function runs<T>(values: T[]): [number, number, T][] {
  const out: [number, number, T][] = [];
  values.forEach((value, index) => {
    const last = out[out.length - 1];
    if (last && last[2] === value) last[1] = index + 1;
    else out.push([index + 1, index + 1, value]);
  });
  return out;
}

function sizeBand(chars: number) {
  if (chars === 0) return "blank";
  if (chars < 800) return "short";
  if (chars < 3000) return "medium";
  if (chars < 6000) return "long";
  return "very long";
}

/**
 * Page count, size per page (as runs), where the first line changes (a cheap
 * section map), and the Sweep's Candidates per page and by signal.
 */
export function outlineText(
  document: DocumentText,
  candidates: SweepCandidate[],
  state: Pick<AnalystState, "register" | "dismissed">,
) {
  const pages = document.pages;
  const chars = pages.map((page) => page.length);
  const total = chars.reduce((sum, count) => sum + count, 0);
  const perPage = new Array<number>(pages.length).fill(0);
  const bySignal = new Map<string, number>();
  for (const candidate of candidates) {
    for (const page of candidate.pages) {
      if (page >= 1 && page <= pages.length) perPage[page - 1]++;
    }
    for (const signal of candidate.signals)
      bySignal.set(signal, (bySignal.get(signal) ?? 0) + 1);
  }
  const statuses = candidateStatuses(candidates, state);
  const open = statuses.filter((entry) => entry.status === "open").length;

  const headings: string[] = [];
  let previous = "";
  pages.forEach((page, index) => {
    const line = firstLine(page);
    if (line && line !== previous && headings.length < MAX_HEADINGS) {
      headings.push(`p${index + 1}: ${line}`);
    }
    previous = line;
  });

  return [
    `"${document.title}": ${pages.length} pages, ${total.toLocaleString("en")} characters (≈${Math.round(total / 4).toLocaleString("en")} tokens), ${Math.round(total / Math.max(1, pages.length))} per page on average.`,
    `Page sizes: ${runs(chars.map(sizeBand))
      .map(
        ([from, to, band]) => `${from === to ? from : `${from}-${to}`} ${band}`,
      )
      .join("; ")}.`,
    `Sweep: ${candidates.length} Candidates (${open} open). By signal: ${[
      ...bySignal,
    ]
      .sort((a, b) => b[1] - a[1])
      .map(([signal, count]) => `${signal} ${count}`)
      .join(", ")}.`,
    `Candidates per page: ${perPage.map((count, index) => `${index + 1}:${count}`).join(" ")}`,
    `Section starts (first line where it changes${headings.length >= MAX_HEADINGS ? `, first ${MAX_HEADINGS}` : ""}):`,
    ...headings,
  ].join("\n");
}

export type ReadPagesInput = { from: number; to?: number };

/**
 * The text of up to `pagesPerRead` pages. A page cut to fit is shown but not
 * counted as read: the Done gate counts only pages seen whole.
 */
export function readPages(document: DocumentText, input: ReadPagesInput) {
  const total = document.pages.length;
  const from = Math.trunc(input.from);
  const to = Math.trunc(input.to ?? input.from);
  if (!(from >= 1 && to >= from && to <= total)) {
    return {
      text: `read_pages refused: pages must be within 1-${total} and from ≤ to (got ${from}-${to}).`,
      read: [] as number[],
    };
  }
  if (to - from + 1 > RUN_LIMITS.pagesPerRead) {
    return {
      text: `read_pages refused: at most ${RUN_LIMITS.pagesPerRead} pages per call (asked for ${to - from + 1}). For more, use spawn_readers.`,
      read: [] as number[],
    };
  }
  const budget = Math.floor(RUN_LIMITS.charsPerRead / (to - from + 1));
  const read: number[] = [];
  const parts: string[] = [];
  for (let page = from; page <= to; page++) {
    const text = document.pages[page - 1];
    if (text.length <= budget) {
      read.push(page);
      parts.push(`=== Page ${page} ===\n${text}`);
    } else {
      parts.push(
        `=== Page ${page} (cut at ${budget} of ${text.length} characters; NOT counted as read, give it to a Reader) ===\n${text.slice(0, budget)}`,
      );
    }
  }
  return { text: parts.join("\n\n"), read };
}
