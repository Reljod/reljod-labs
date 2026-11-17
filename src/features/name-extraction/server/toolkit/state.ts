/**
 * The Analyst's working state between steps, and the Done gate over it.
 * Pure: no I/O, so the workflow, the eval script and the tests share it.
 * Everything here crosses workflow step boundaries, so it stays plain JSON.
 */
import type { ModelMessage } from "ai";
import type {
  DocumentSource,
  DocumentText,
  DoneGate,
  ExtractedName,
  ModelChoice,
  Rulebook,
  SkillId,
} from "../../domain/contract";
import { nameKey } from "../../domain/resolve";
import type { Candidate } from "../../domain/sweep";

/** Hard caps on one Run. Paid work is capped at every entry point (conventions.md). */
export const RUN_LIMITS = {
  /** Analyst model calls per Run. */
  analystTurns: 40,
  /** Readers per Run, across every spawn_readers call. */
  readers: 64,
  /** Readers per spawn_readers call. */
  readersPerCall: 32,
  /** Pages one Reader may take. */
  pagesPerReader: 30,
  /** Characters one Reader may take: keeps a call under ~100k input tokens. */
  charsPerReader: 250_000,
  /** Pages one read_pages call returns. */
  pagesPerRead: 6,
  /** Characters one read_pages call returns. */
  charsPerRead: 40_000,
  /** run_code calls per Run. */
  codeRuns: 30,
  /** USD of model calls one Run may spend before it is wound up. */
  costUsd: 2,
  /** Characters of any one tool result the Analyst sees. */
  toolOutputChars: 12_000,
  /** Output tokens of one Analyst turn. */
  analystOutputTokens: 8_000,
  /** Output tokens of one Reader call. */
  readerOutputTokens: 16_000,
} as const;

/** What a Run is about. Fixed for the Run, so it is passed to every step. */
export type RunContext = {
  runId: string;
  source: DocumentSource;
  title: string;
  pages: number;
  models: ModelChoice;
  rulebook: Rulebook;
  rulebookVersion: number;
};

export type ReaderRun = {
  readerId: string;
  from: number;
  to: number;
  model: string;
  /** Names it returned, after unverifiable mentions were dropped. */
  names: number;
  /** Mentions dropped because the quote is not on its page. */
  dropped: number;
  error?: string;
};

export type AnalystState = {
  messages: ModelMessage[];
  register: ExtractedName[];
  /** Sweep Candidates dismissed by the Analyst: id → reason. */
  dismissed: Record<string, string>;
  /** Pages a Reader or read_pages covered, sorted. */
  pagesRead: number[];
  readers: ReaderRun[];
  skills: SkillId[];
  turns: number;
  codeRuns: number;
  costUsd: number;
};

export function initialState(): AnalystState {
  return {
    messages: [],
    register: [],
    dismissed: {},
    pagesRead: [],
    readers: [],
    skills: [],
    turns: 0,
    codeRuns: 0,
    costUsd: 0,
  };
}

/** A Sweep Candidate with its stable id: its index in the Sweep's output. */
export type SweepCandidate = Candidate & { id: number };

export function numbered(candidates: Candidate[]): SweepCandidate[] {
  return candidates.map((candidate, id) => ({ ...candidate, id }));
}

/** Every key the Register answers to: canonicals, aliases and the quoted forms. */
export function registerKeys(register: ExtractedName[]) {
  const keys = new Set<string>();
  for (const name of register) {
    for (const form of [
      name.canonical,
      ...name.aliases,
      ...name.mentions.map((mention) => mention.quote),
    ]) {
      const key = nameKey(form);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export type CandidateStatus = "open" | "recorded" | "dismissed";

/**
 * Where each Candidate stands. Recorded means a Name in the Register answers
 * to it (as canonical, alias or quoted form); it is worked out, never stored,
 * so a merge or a new alias closes Candidates by itself.
 */
export function candidateStatuses(
  candidates: SweepCandidate[],
  state: Pick<AnalystState, "register" | "dismissed">,
): { candidate: SweepCandidate; status: CandidateStatus; reason?: string }[] {
  const keys = registerKeys(state.register);
  return candidates.map((candidate) => {
    if (keys.has(nameKey(candidate.text)))
      return { candidate, status: "recorded" };
    const reason = state.dismissed[String(candidate.id)];
    if (reason !== undefined) return { candidate, status: "dismissed", reason };
    return { candidate, status: "open" };
  });
}

export function doneGate(
  pagesTotal: number,
  candidates: SweepCandidate[],
  state: Pick<AnalystState, "register" | "dismissed" | "pagesRead">,
): DoneGate {
  const pagesRead = new Set(
    state.pagesRead.filter((page) => page >= 1 && page <= pagesTotal),
  ).size;
  const candidatesOpen = candidateStatuses(candidates, state).filter(
    (entry) => entry.status === "open",
  ).length;
  return {
    pagesTotal,
    pagesRead,
    candidatesOpen,
    passed: pagesRead === pagesTotal && candidatesOpen === 0,
  };
}

/** Pages not yet read, as compact ranges ("4-9, 31, 40-52"). */
export function unreadRanges(pagesTotal: number, pagesRead: number[]) {
  const read = new Set(pagesRead);
  const ranges: [number, number][] = [];
  for (let page = 1; page <= pagesTotal; page++) {
    if (read.has(page)) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === page - 1) last[1] = page;
    else ranges.push([page, page]);
  }
  return ranges;
}

export function rangesText(ranges: [number, number][]) {
  return ranges
    .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
    .join(", ");
}

/** Adds pages to the read set, kept sorted and unique. */
export function markRead(pagesRead: number[], pages: number[]) {
  return [...new Set([...pagesRead, ...pages])].sort((a, b) => a - b);
}

/**
 * Why `finish` is refused, in words the Analyst can act on: the pages still
 * unread and a sample of the open Candidates with their ids.
 */
export function gateRefusal(
  gate: DoneGate,
  candidates: SweepCandidate[],
  state: Pick<AnalystState, "register" | "dismissed" | "pagesRead">,
) {
  const lines = [
    `finish refused: the Done gate has not passed (pages read ${gate.pagesRead}/${gate.pagesTotal}, open Candidates ${gate.candidatesOpen}).`,
  ];
  if (gate.pagesRead < gate.pagesTotal) {
    lines.push(
      `Unread pages: ${rangesText(unreadRanges(gate.pagesTotal, state.pagesRead))}. Cover them with spawn_readers or read_pages.`,
    );
  }
  if (gate.candidatesOpen > 0) {
    const open = candidateStatuses(candidates, state)
      .filter((entry) => entry.status === "open")
      .slice(0, 25)
      .map(
        ({ candidate }) =>
          `#${candidate.id} "${candidate.text}" (p. ${candidate.pages.slice(0, 4).join(", ")}${candidate.pages.length > 4 ? ", …" : ""}; ${candidate.signals.join(", ")})`,
      );
    lines.push(
      `Open Candidates (first ${open.length} of ${gate.candidatesOpen}): record each as a Name or alias with record_names, or dismiss it with a reason. Group dismissals by id lists; run_code can select ids.`,
      ...open,
    );
  }
  return lines.join("\n");
}

/** Caps a tool result so one call cannot flood the Analyst's context. */
export function cap(text: string, max: number = RUN_LIMITS.toolOutputChars) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${text.length - max} more characters cut; narrow the request]`;
}

export type DocumentLoader = (ctx: RunContext) => Promise<DocumentText>;
