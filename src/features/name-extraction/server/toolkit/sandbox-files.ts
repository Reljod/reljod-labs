/**
 * What the Sandbox holds for `run_code`: the pages, the Run's state as JSON
 * and the `sieve.mjs` helper library. Pure: builds the file list only.
 */
import type { DocumentText, ExtractedName } from "../../domain/contract";
import {
  type AnalystState,
  candidateStatuses,
  type ReaderRun,
  type SweepCandidate,
} from "./state";

export const DOC_DIR = "/vercel/doc";
export const RUN_DIR = "/vercel/run";

export function pagePath(page: number) {
  return `${DOC_DIR}/pages/${String(page).padStart(4, "0")}.txt`;
}

/** The helper library the Analyst imports from /vercel/doc/sieve.mjs. */
export const SIEVE_MJS = `// Sieve helpers for run_code. Read-only views of the Document and the Run.
import { readFileSync, readdirSync } from "node:fs";

const DIR = ${JSON.stringify(DOC_DIR)};
const json = (name) => JSON.parse(readFileSync(DIR + "/" + name, "utf8"));
let cache;

/** Every page's text; pages()[0] is page 1. */
export function pages() {
  if (!cache) {
    const files = readdirSync(DIR + "/pages").filter((f) => f.endsWith(".txt")).sort();
    cache = files.map((f) => readFileSync(DIR + "/pages/" + f, "utf8"));
  }
  return cache;
}
export const page = (n) => pages()[n - 1] ?? "";
export const lines = (n) => page(n).split("\\n");
/** A page with hyphenated and wrapped lines joined into one line. */
export const joined = (n) => page(n).replace(/-\\n(?=\\p{Ll})/gu, "").replace(/\\s*\\n\\s*/g, " ");
export const meta = () => json("meta.json");
export const candidates = (filter = {}) =>
  json("candidates.json").filter((c) => !filter.status || c.status === filter.status);
export const register = () => json("register.json");
export const readers = () => json("readers.json");

/** Every match of a regex, with page, line and groups. Adds the g flag. */
export function grep(regex, { from = 1, to = Infinity } = {}) {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  const hits = [];
  pages().forEach((text, i) => {
    const n = i + 1;
    if (n < from || n > to) return;
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\\n").length;
      hits.push({ page: n, line, text: text.split("\\n")[line - 1], match: m[0], groups: m.slice(1) });
    }
  });
  return hits;
}

export function perPageCounts(list) {
  const counts = {};
  for (const c of list) for (const p of c.pages) counts[p] = (counts[p] ?? 0) + 1;
  return counts;
}

const HONORIFICS = /\\b(mr|mrs|ms|miss|mx|dr|prof|sir|dame|lord|lady|hon|rev|sr|jr|esq|mme|mlle|herr|frau|sra|don|dona)\\b\\.?/g;
/** Lower case, no diacritics, no honorifics, no punctuation, single spaces. */
export function fold(s) {
  return String(s)
    .normalize("NFKD").replace(/\\p{M}+/gu, "")
    .toLowerCase().replace(HONORIFICS, " ")
    .replace(/[^\\p{L}\\p{N}]+/gu, " ").trim().replace(/\\s+/g, " ");
}
const tokens = (s) => fold(s).split(" ").filter(Boolean);
/** Same tokens in any order ("Bank of Meridia" vs "Meridia Bank" after dropping "of"). */
export function tokenSet(a, b) {
  const stop = new Set(["of", "the", "and", "de", "la", "del", "van", "von", "der"]);
  const ta = tokens(a).filter((t) => !stop.has(t)).sort().join(" ");
  const tb = tokens(b).filter((t) => !stop.has(t)).sort().join(" ");
  return ta.length > 0 && ta === tb;
}
/** "A L Ferreira-Vos" ~ "Ana Lucía Ferreira-Vos": same surname, compatible initials. */
export function initialsMatch(a, b) {
  const [x, y] = [tokens(a), tokens(b)];
  if (!x.length || !y.length) return false;
  const surname = (t) => t[t.length - 1];
  const sx = x.includes(surname(y)) ? surname(y) : x.includes(y[0]) ? y[0] : null;
  if (!sx || !y.includes(sx)) return false;
  const gx = x.filter((t) => t !== sx).map((t) => t[0]);
  const gy = y.filter((t) => t !== sx).map((t) => t[0]);
  const [short, long] = gx.length <= gy.length ? [gx, gy] : [gy, gx];
  return short.every((c, i) => long[i] === c);
}
/** Jaro-Winkler on folded strings, always applying the prefix bonus (OFAC style). */
export function jaroWinkler(a, b) {
  const s = fold(a), t = fold(b);
  if (!s.length || !t.length) return 0;
  if (s === t) return 1;
  const range = Math.max(0, Math.floor(Math.max(s.length, t.length) / 2) - 1);
  const ms = new Array(s.length).fill(false), mt = new Array(t.length).fill(false);
  let m = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(t.length, i + range + 1); j++) {
      if (!mt[j] && s[i] === t[j]) { ms[i] = mt[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let k = 0, tr = 0;
  for (let i = 0; i < s.length; i++) if (ms[i]) { while (!mt[k]) k++; if (s[i] !== t[k]) tr++; k++; }
  const jaro = (m / s.length + m / t.length + (m - tr / 2) / m) / 3;
  let p = 0;
  while (p < 4 && s[p] === t[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/** Prints a value as JSON (strings as they are), capped. */
export function out(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  process.stdout.write(text.length > 7800 ? text.slice(0, 7800) + "\\n… [cut]\\n" : text + "\\n");
}
`;

export type SandboxFile = { path: string; content: string };

/** The pages, written once when the Sandbox is created. */
export function documentFiles(document: DocumentText): SandboxFile[] {
  return [
    ...document.pages.map((text, index) => ({
      path: pagePath(index + 1),
      content: text,
    })),
    {
      path: `${DOC_DIR}/meta.json`,
      content: JSON.stringify({
        id: document.id,
        title: document.title,
        pages: document.pages.length,
      }),
    },
    { path: `${DOC_DIR}/sieve.mjs`, content: SIEVE_MJS },
  ];
}

/** The Run's state, rewritten before every run_code so it is current. */
export function stateFiles(
  candidates: SweepCandidate[],
  state: Pick<AnalystState, "register" | "dismissed" | "readers">,
): SandboxFile[] {
  const statuses = candidateStatuses(candidates, state).map(
    ({ candidate, status, reason }) => ({
      ...candidate,
      status,
      ...(reason ? { reason } : {}),
    }),
  );
  return [
    { path: `${DOC_DIR}/candidates.json`, content: JSON.stringify(statuses) },
    {
      path: `${DOC_DIR}/register.json`,
      content: JSON.stringify(state.register satisfies ExtractedName[]),
    },
    {
      path: `${DOC_DIR}/readers.json`,
      content: JSON.stringify(state.readers satisfies ReaderRun[]),
    },
  ];
}
