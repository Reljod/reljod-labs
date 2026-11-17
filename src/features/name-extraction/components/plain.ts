/**
 * Sieve in plain business language: what a Run did, as a stakeholder reads
 * it, and the state of every page for the page map. Pure, so the live run
 * and the hero's replay draw from the same functions.
 */
import type { ExtractedName, SkillId } from "../domain/contract";
import type { RunView } from "./run-view";

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** Playbooks (Skills) by the job they do, not their file name. */
export const PLAYBOOK: Record<SkillId, string> = {
  "long-document-triage": "long-document triage",
  "aml-name-patterns": "AML name patterns",
  "alias-resolution": "alias resolution",
  "recall-audit": "missed-name audit",
  "sandbox-coding": "writing checks in code",
};

/** `{ from, to }` of a page-range tool call, from its input or its short summary. */
export function rangeOf(
  input: unknown,
  summary = "",
): { from: number; to: number } | null {
  if (input && typeof input === "object") {
    const { from, to } = input as { from?: unknown; to?: unknown };
    if (typeof from === "number")
      return { from, to: typeof to === "number" ? to : from };
  }
  const match = /pages?\s+(\d+)(?:\s*[-–]\s*(\d+))?/i.exec(summary);
  if (!match) return null;
  const from = Number(match[1]);
  return { from, to: match[2] ? Number(match[2]) : from };
}

function rangesOf(input: unknown): { from: number; to: number }[] {
  if (!input || typeof input !== "object") return [];
  const { ranges } = input as { ranges?: unknown };
  if (!Array.isArray(ranges)) return [];
  return ranges.flatMap((range) => {
    const parsed = rangeOf(range);
    return parsed ? [parsed] : [];
  });
}

const span = ({ from, to }: { from: number; to: number }) =>
  from === to ? `page ${from}` : `pages ${from}–${to}`;

export type ActivityKind =
  | "map"
  | "read"
  | "readers"
  | "search"
  | "code"
  | "playbook"
  | "names"
  | "check"
  | "note";

export type Activity = {
  key: string;
  at: number;
  kind: ActivityKind;
  text: string;
  /** Still running. */
  live: boolean;
  /** Ended in an error or a refusal. */
  failed: boolean;
};

function countIn(summary: string, word: string) {
  const match = new RegExp(`${word}\\s+(\\d+)`).exec(summary);
  return match ? Number(match[1]) : 0;
}

/** The Run as a short activity feed in plain language, oldest first. */
export function activityOf(view: RunView): Activity[] {
  const items: Activity[] = [];
  const pages = view.document?.pages ?? 0;
  for (const item of view.timeline) {
    const base = { key: `${item.kind}-${item.seq}`, at: item.at };
    if (item.kind === "skill") {
      items.push({
        ...base,
        kind: "playbook",
        text: `Loaded the playbook: ${PLAYBOOK[item.skill] ?? item.skill}`,
        live: false,
        failed: false,
      });
      continue;
    }
    if (item.kind === "log") {
      if (item.level === "info") continue;
      items.push({
        ...base,
        kind: "note",
        text: item.text,
        live: false,
        failed: item.level === "error",
      });
      continue;
    }
    if (item.kind === "thought") continue;
    const live = item.state === "start";
    const failed = item.state === "error";
    const tool = { ...base, key: `tool-${item.callId}`, live, failed };
    switch (item.tool) {
      case "outline":
        items.push({
          ...tool,
          kind: "map",
          text: pages
            ? `Mapped the document: ${plural(pages, "page")}`
            : "Mapped the document",
        });
        break;
      case "read_pages": {
        const range = rangeOf(item.input, item.summary);
        items.push({
          ...tool,
          kind: "read",
          text: range ? `Read ${span(range)}` : "Read a few pages",
        });
        break;
      }
      case "grep":
        items.push({
          ...tool,
          kind: "search",
          text: "Searched every page for a name pattern",
        });
        break;
      case "run_code": {
        const purpose =
          item.summary && item.summary !== "code" ? item.summary : "";
        items.push({
          ...tool,
          kind: "code",
          text: purpose
            ? `Wrote and ran a check: ${purpose.replace(/\.$/, "")}`
            : "Wrote and ran a check in a sandbox",
        });
        break;
      }
      case "spawn_readers": {
        const ranges = rangesOf(item.input);
        const fromSummary = /(\d+)\s+reader/.exec(item.summary);
        const total =
          ranges.length || (fromSummary ? Number(fromSummary[1]) : 0);
        const first = Math.min(...ranges.map((range) => range.from));
        const last = Math.max(...ranges.map((range) => range.to));
        items.push({
          ...tool,
          kind: "readers",
          text:
            ranges.length > 0
              ? `Sent ${plural(total, "reader agent")} across ${span({ from: first, to: last })}`
              : total
                ? `Sent ${plural(total, "reader agent")} out in parallel`
                : "Sent reader agents out in parallel",
        });
        break;
      }
      case "load_skill":
        // The `skill` event says it in words; the tool call itself is noise here.
        break;
      case "record_names": {
        const added = countIn(item.summary, "add");
        const merged = countIn(item.summary, "merge");
        const dismissed = countIn(item.summary, "dismiss");
        const parts = [
          added ? `added ${plural(added, "name")}` : "",
          merged ? `merged ${plural(merged, "duplicate")}` : "",
          dismissed ? `ruled out ${plural(dismissed, "false lead")}` : "",
        ].filter(Boolean);
        const text = parts.length > 0 ? parts.join(", ") : "updated the list";
        items.push({
          ...tool,
          kind: "names",
          text: text[0].toUpperCase() + text.slice(1),
        });
        break;
      }
      case "finish":
        items.push({
          ...tool,
          kind: "check",
          failed: false,
          text: failed
            ? "Final check: not done yet, kept going"
            : live
              ? "Running the final check"
              : "Passed the final check: every page read",
        });
        break;
    }
  }
  return items;
}

// The page map ---------------------------------------------------------------

export const PAGE_UNREAD = 0;
export const PAGE_READING = 1;
export const PAGE_READ = 2;

/** Who is reading a page: a reader agent's colour slot, or the lead agent. */
export const LEAD = -1;

export type PageMap = {
  /** PAGE_UNREAD, PAGE_READING or PAGE_READ for each page, index 0 = page 1. */
  state: Uint8Array;
  /** Colour slot of the reader on the page, LEAD for the lead agent, while it reads. */
  reader: Int16Array;
  read: number;
};

/**
 * What each page is going through: read, being read (and by whom), or not
 * yet. A page being read wins over one already read (readers overlap by a
 * page). Once the Run is over, nothing is being read.
 */
export function pageMap(view: RunView, total: number): PageMap {
  const state = new Uint8Array(total);
  const reader = new Int16Array(total).fill(LEAD);
  const mark = (from: number, to: number, value: number, slot: number) => {
    for (let page = Math.max(1, from); page <= Math.min(total, to); page++) {
      const index = page - 1;
      if (value === PAGE_READING) {
        state[index] = PAGE_READING;
        reader[index] = slot;
      } else if (state[index] !== PAGE_READING) state[index] = PAGE_READ;
    }
  };
  for (const item of view.timeline) {
    if (item.kind !== "tool" || item.tool !== "read_pages") continue;
    const range = rangeOf(item.input, item.summary);
    if (!range) continue;
    if (item.state === "done") mark(range.from, range.to, PAGE_READ, LEAD);
    if (item.state === "start") mark(range.from, range.to, PAGE_READING, LEAD);
  }
  view.readers.forEach((item, slot) => {
    if (item.state === "done") mark(item.from, item.to, PAGE_READ, slot);
  });
  view.readers.forEach((item, slot) => {
    if (item.state === "start") mark(item.from, item.to, PAGE_READING, slot);
  });
  const finished =
    view.status === "completed" &&
    (view.gate?.passed ?? false) &&
    view.gate?.pagesRead === total;
  if (finished) state.fill(PAGE_READ);
  let read = 0;
  for (const value of state) if (value === PAGE_READ) read++;
  return { state, reader, read: Math.max(read, view.gate?.pagesRead ?? 0) };
}

/** Distinct Names on each page, index 0 = page 1. */
export function namesPerPage(names: ExtractedName[], total: number) {
  const counts = new Uint16Array(total);
  for (const name of names) {
    const pages = new Set(name.mentions.map((mention) => mention.page));
    for (const page of pages)
      if (page >= 1 && page <= total) counts[page - 1]++;
  }
  return counts;
}

/** The first page a Name appears on, or 1. */
export const firstPage = (name: ExtractedName) =>
  name.mentions.length === 0
    ? 1
    : Math.min(...name.mentions.map((mention) => mention.page));

/**
 * The names the stage may show so far: each one once the first page it is
 * on has been read, all of them once the Run is over. A recorded Run keeps
 * only its final list, so this is what makes its names arrive as pages are
 * read rather than in one lump.
 */
export function revealable(
  pool: ExtractedName[],
  state: Uint8Array,
  over: boolean,
): ExtractedName[] {
  if (over) return pool;
  return pool.filter((name) => {
    const page = firstPage(name);
    return page > state.length || state[page - 1] === PAGE_READ;
  });
}
