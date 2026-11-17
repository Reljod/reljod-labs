/**
 * `grep`: a regex over every page, safe against patterns the model writes.
 * The pattern runs inside a `node:vm` context with a timeout, which
 * interrupts catastrophic backtracking (V8 checks for interrupts while a
 * regex backtracks), and hits, context and pattern length are all capped.
 */
import { runInNewContext } from "node:vm";

export const GREP_LIMITS = {
  patternChars: 300,
  maxHits: 200,
  defaultHits: 60,
  contextChars: 160,
  defaultContext: 60,
  timeoutMs: 1500,
};

const ALLOWED_FLAGS = new Set(["i", "m", "s", "u"]);

export type GrepInput = {
  pattern: string;
  flags?: string;
  from?: number;
  to?: number;
  maxHits?: number;
  context?: number;
};

export type GrepHit = {
  page: number;
  index: number;
  match: string;
  text: string;
};

export type GrepResult =
  | {
      ok: true;
      hits: GrepHit[];
      /** Matches per page across the searched pages, including hits past the cap. */
      perPage: Record<number, number>;
      total: number;
      truncated: boolean;
    }
  | { ok: false; error: string };

/** Validates a pattern and flags, or says why not. Never compiles in the host. */
export function checkPattern(pattern: string, flags = "") {
  if (!pattern) return "The pattern is empty.";
  if (pattern.length > GREP_LIMITS.patternChars)
    return `The pattern is over ${GREP_LIMITS.patternChars} characters.`;
  for (const flag of flags) {
    if (!ALLOWED_FLAGS.has(flag))
      return `Flag "${flag}" is not allowed; use any of i, m, s, u (g is implied).`;
  }
  if (new Set(flags).size !== flags.length) return "A flag is repeated.";
  return null;
}

const SCRIPT = `
(() => {
  const re = new RegExp(pattern, flags + "g");
  const hits = [];
  const perPage = {};
  let total = 0;
  for (let i = from - 1; i < to; i++) {
    const text = pages[i] ?? "";
    re.lastIndex = 0;
    let m;
    let count = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === "") { re.lastIndex++; continue; }
      count++;
      total++;
      if (hits.length < maxHits) {
        const start = Math.max(0, m.index - context);
        const end = Math.min(text.length, m.index + m[0].length + context);
        hits.push({ page: i + 1, index: m.index, match: m[0].slice(0, 200), text: text.slice(start, end) });
      }
      if (total > 100000) break;
    }
    if (count) perPage[i + 1] = count;
  }
  return JSON.stringify({ hits, perPage, total });
})()`;

/** Runs a regex over pages `from`..`to` (1-based, inclusive). */
export function grepPages(pages: string[], input: GrepInput): GrepResult {
  const flags = input.flags ?? "";
  const problem = checkPattern(input.pattern, flags);
  if (problem) return { ok: false, error: problem };
  try {
    // Compile once in the host only to report syntax errors; never executed here.
    new RegExp(input.pattern, `${flags}g`);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid regex: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const from = Math.max(1, Math.trunc(input.from ?? 1));
  const to = Math.min(pages.length, Math.trunc(input.to ?? pages.length));
  if (from > to) return { ok: false, error: `No pages in ${from}-${to}.` };
  const maxHits = Math.max(
    1,
    Math.min(
      GREP_LIMITS.maxHits,
      Math.trunc(input.maxHits ?? GREP_LIMITS.defaultHits),
    ),
  );
  const context = Math.max(
    0,
    Math.min(
      GREP_LIMITS.contextChars,
      Math.trunc(input.context ?? GREP_LIMITS.defaultContext),
    ),
  );
  try {
    const raw = runInNewContext(
      SCRIPT,
      { pages, pattern: input.pattern, flags, from, to, maxHits, context },
      { timeout: GREP_LIMITS.timeoutMs },
    ) as string;
    const parsed = JSON.parse(raw) as {
      hits: GrepHit[];
      perPage: Record<number, number>;
      total: number;
    };
    return {
      ok: true,
      ...parsed,
      truncated: parsed.total > parsed.hits.length,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      return {
        ok: false,
        error: `The regex took over ${GREP_LIMITS.timeoutMs} ms (catastrophic backtracking?). Simplify it: avoid nested quantifiers like (a+)+.`,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The result as the Analyst reads it. */
export function grepText(result: GrepResult) {
  if (!result.ok) return `grep failed: ${result.error}`;
  if (result.total === 0) return "No matches.";
  const pages = Object.entries(result.perPage);
  const lines = [
    `${result.total} match${result.total === 1 ? "" : "es"} on ${pages.length} page${pages.length === 1 ? "" : "s"}${result.truncated ? ` (first ${result.hits.length} shown)` : ""}.`,
    `Per page: ${pages
      .slice(0, 150)
      .map(([page, count]) => `${page}:${count}`)
      .join(" ")}${pages.length > 150 ? " …" : ""}`,
    ...result.hits.map(
      (hit) => `p${hit.page}: …${hit.text.replace(/\s+/g, " ").trim()}…`,
    ),
  ];
  return lines.join("\n");
}
