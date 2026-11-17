/**
 * The Sweep: a deterministic, model-free pass over every page that proposes
 * Candidates. It sets the recall floor, so it errs towards proposing: the
 * Analyst records or dismisses every Candidate. See ../GLOSSARY.md.
 */
import type { DocumentText, EntityType, Rulebook } from "./contract";

export type Candidate = {
  text: string;
  typeGuess: EntityType | "unknown";
  pages: number[];
  count: number;
  signals: string[];
};

// Word lists -----------------------------------------------------------------------------

const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "prof",
  "sir",
  "dame",
  "lady",
  "lord",
  "hon",
  "honourable",
  "justice",
  "judge",
  "sheikh",
  "sheikha",
  "chief",
  "rev",
  "fr",
  "sr",
  "sra",
  "mme",
  "mlle",
  "herr",
  "frau",
  "notary",
  "registrar",
  "det",
  "insp",
  "inspector",
  "detective",
  "capt",
  "captain",
  "atty",
]);

const OFFICIAL =
  /^(hon\.?|justice|judge|registrar|notary|det\.?|insp\.?|inspector|detective)\b/i;

const PARTICLES = new Set([
  "van",
  "der",
  "den",
  "de",
  "del",
  "della",
  "la",
  "le",
  "dos",
  "das",
  "da",
  "do",
  "du",
  "von",
  "bin",
  "binti",
  "ibn",
  "al",
  "el",
  "ter",
  "ten",
  "af",
  "zu",
  "y",
]);

const ORG_WORDS = new Set([
  "ltd",
  "limited",
  "llc",
  "llp",
  "lp",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "plc",
  "sa",
  "s.a",
  "sas",
  "sarl",
  "s.a.r.l",
  "srl",
  "spa",
  "gmbh",
  "ag",
  "kg",
  "bv",
  "b.v",
  "nv",
  "n.v",
  "pte",
  "pty",
  "holdings",
  "holding",
  "group",
  "trust",
  "foundation",
  "fundacion",
  "stiftung",
  "bank",
  "partners",
  "capital",
  "ventures",
  "trading",
  "logistics",
  "shipping",
  "maritime",
  "commodities",
  "investments",
  "properties",
  "consulting",
  "imports",
  "exports",
  "freight",
  "metals",
  "minerals",
  "energy",
  "textiles",
  "agro",
  "industries",
  "international",
  "enterprises",
  "services",
  "solutions",
  "associates",
  "pharma",
  "l.l.c",
  "&",
]);

/** Abbreviations whose trailing dot belongs to the word. */
const KEEP_DOT =
  /^(\p{Lu}\.|inc\.|ltd\.|co\.|jr\.|sr\.|sra\.|pte\.|dr\.|hon\.|prof\.|det\.|insp\.|st\.|(\p{L}\.){2,})$/iu;

/** Words that never start, end or sit inside a name: labels, months, document words. */
const STOP = new Set(
  `a an the this that these those on in at for from to by with and or of as is was are were be been
  re fw fwd subject date dated page pages total totals balance amount amounts reference ref refs our your
  account accounts statement statements transfer transfers payment payments credit credits debit debits
  opening closing description value currency invoice invoices lading letter section article clause
  schedule annex exhibit court judgment order orders minutes meeting meetings board resolution resolved item
  items present apologies attendance chair secretary director directors shareholder shareholders owner
  owners beneficial ultimate name names full address addresses nationality passport birth occupation
  signature signed sign witness notes note summary narrative suspicious activity report reports customer
  customers client clients risk rating high medium low yes no unknown confidential internal use only copy
  original tel fax email phone dear regards kind best thanks thank please hi hello sent cc bcc attachment
  attachments monday tuesday wednesday thursday friday saturday sunday january february march april may
  june july august september october november december feb mar apr jun jul aug sep sept oct nov dec
  specimen synthetic document documents record records republic central meridia meridian beneficiary
  ordering remitter applicant guarantor shipper consignee notify party parties drawee drawer introducer
  introduced counterparty payee payer attn attention claimant defendant respondent appellant company
  registration registered office incorporated filing history form forms extract certified issued seal
  registry registrar companies certificate subject role prepared also known source funds residential
  related relationship verified checklist received checked factor score comment geography product channel
  expected agenda finance compliance contracts approval business matters previous management cash deposit
  deposits branch interest fee fees monthly pos atm wdl so chq fx nostro sweep refund card trf rent mt103
  swift ledger batch outgoing incoming operations desk export review set custodian produced mailbox chat
  irrevocable documentary number advising expiry port loading discharge vessel packing list cartons gross
  card settlement authorised authorized signatory due diligence file
  kg uniform customs practice credits draft insurance discrepancy notice period ending held approved
  presented reported noted declared loan unit crime financial division commercial high claim approved
  before between mlro alert analysis further following analyst branch staff open source checks onward
  funds layered pattern turnover stated purpose consent economic structuring cut off ml aml kyc sar str
  pep ubo id cif no nos vat tax usd mrd eur gbp m$ fyi asap ok
  officer manager head controller managing reporting laundering money public`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words that mark a street, a place or a vessel, not a party. */
const DECOY_WORDS = new Set([
  "street",
  "st",
  "road",
  "rd",
  "avenue",
  "ave",
  "avenida",
  "rua",
  "calle",
  "rue",
  "jalan",
  "lane",
  "boulevard",
  "blvd",
  "quay",
  "gardens",
  "plaza",
  "square",
  "ulitsa",
  "drive",
  "terrace",
  "point",
  "way",
  "highway",
  "harbour",
  "harbor",
  "bay",
]);
const PLACE_START = new Set([
  "port",
  "mount",
  "lake",
  "cape",
  "fort",
  "vila",
  "isla",
  "puerto",
  "porto",
  "san",
  "santa",
  "st.",
]);
const VESSEL_START = new Set(["MV", "MT", "SS", "M/V"]);

const GENERIC_MAILBOX = new Set([
  "info",
  "admin",
  "noreply",
  "no-reply",
  "compliance",
  "ops",
  "payments",
  "accounts",
  "trade",
  "support",
  "contact",
  "office",
  "mail",
  "desk",
  "enquiries",
  "hello",
  "team",
]);

const LABEL =
  /^\s*(beneficiary(?: name)?|ordering customer|remitter|account holder|account name|customer|full name|name|also known as|aka|introduced by|introducer|director|shareholder|holder|beneficial owner|ultimate beneficial owner|ubo|signatory|authori[sz]ed signatory|signed by|prepared by|applicant|guarantor|shipper|consignee|notify party|drawee|drawer|witness|counterparty|payee|payer|attn|attention|chair|present|in attendance|apologies|claimant|defendant|respondent|appellant|company name|from|to|cc)\s*:\s*(.+)$|^\s*(c\/o)\s+(.+)$/i;
const LIST_LABELS = new Set([
  "present",
  "apologies",
  "in attendance",
  "to",
  "cc",
]);
const SWIFT_PARTY = /^\s*:(50[AFK]|59[AF]?):/;
const EMAIL =
  /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const TOKEN = /[\p{L}\p{M}][\p{L}\p{M}'’.\-/]*|&/gu;
const BIC = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

// Tokens and runs ------------------------------------------------------------------------

type Tok = {
  text: string;
  lower: string;
  caps: boolean;
  kind: "cap" | "particle" | "amp";
  /** The raw word ended a sentence ("Okafor."). */
  end?: boolean;
};

const LEGAL_END = new Set([
  "ltd",
  "ltd.",
  "limited",
  "llc",
  "l.l.c.",
  "llp",
  "inc",
  "inc.",
  "plc",
  "s.a.",
  "sa",
  "gmbh",
  "b.v.",
  "bv",
  "n.v.",
  "nv",
  "pte",
  "pte.",
  "pty",
  "corp",
  "corp.",
  "ag",
  "sarl",
  "s.a.r.l.",
]);
const isLegal = (t: Tok | undefined) =>
  t !== undefined && LEGAL_END.has(t.lower);

function classify(raw: string): Tok | null {
  let text = raw;
  let end = false;
  if (text.endsWith("..")) {
    text = text.slice(0, -1);
    end = true;
  }
  if (text !== "&" && text.endsWith(".") && !KEEP_DOT.test(text)) {
    text = text.replace(/\.+$/, "");
    end = true;
  }
  text = text.replace(/[-'’/]+$/, "");
  if (!text) return null;
  const lower = text.toLowerCase();
  if (text === "&" || lower === "and")
    return { text, lower: "&", caps: false, kind: "amp" };
  if (PARTICLES.has(text))
    return { text, lower, caps: false, kind: "particle", end };
  const first = text[0];
  const capital = first !== first.toLowerCase();
  const prefixed = /^(al|el|bin|ibn|abu|van|de|d)[-'’]\p{Lu}/u.test(text);
  if (!capital && !prefixed) return null;
  const letters = text.replace(/[^\p{L}]/gu, "");
  const caps = letters.length >= 2 && letters === letters.toUpperCase();
  return { text, lower, caps, kind: "cap", end };
}

type Run = {
  toks: Tok[];
  gaps: string[];
  start: number;
  end: number;
  trailing: string;
};

/** Splits one line into runs of name-like tokens, separated by single spaces (or one comma). */
function runsOf(line: string): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let lastEnd = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(line); m; m = TOKEN.exec(line)) {
    // A word glued to digits is a code or a postcode ("MR1-2210"), not a name.
    const glued = /\d/.test(line[m.index + m[0].length] ?? "");
    const tok = glued ? null : classify(m[0]);
    const gap = line.slice(lastEnd, m.index);
    const joinable = gap === " " || gap === ", " || gap === "";
    const previous = current?.toks[current.toks.length - 1];
    // A sentence end, or a legal suffix not followed by another, closes the run.
    const closed =
      previous !== undefined &&
      (previous.end === true ||
        (isLegal(previous) && !isLegal(tok ?? undefined)));
    if (
      current &&
      (!tok ||
        !joinable ||
        closed ||
        (gap === ", " && current.gaps.includes(", ")))
    ) {
      current.trailing = gap;
      runs.push(current);
      current = null;
    }
    if (tok) {
      if (current) {
        current.toks.push(tok);
        current.gaps.push(gap === "" ? " " : gap);
        current.end = m.index + m[0].length;
      } else
        current = {
          toks: [tok],
          gaps: [],
          start: m.index,
          end: m.index + m[0].length,
          trailing: "",
        };
    }
    lastEnd = m.index + m[0].length;
  }
  if (current) {
    current.trailing = line.slice(lastEnd);
    runs.push(current);
  }
  return runs;
}

const isStop = (t: Tok) =>
  t.kind === "cap" &&
  !/^\p{Lu}\.$/u.test(t.text) &&
  STOP.has(t.lower.replace(/\.$/, ""));
const isHonorific = (t: Tok) => HONORIFICS.has(t.lower.replace(/\.$/, ""));
const isOrgWord = (t: Tok) => ORG_WORDS.has(t.lower.replace(/\.$/, ""));

type Proposal = {
  text: string;
  type: EntityType | "unknown";
  signals: string[];
};

/** Cuts a run at stop words, trims particles, and keeps the name-shaped pieces. */
function namesInRun(
  toks: Tok[],
  gaps: string[],
  endsSegment: boolean,
): Proposal[] {
  const out: Proposal[] = [];
  let piece: Tok[] = [];
  let pieceGaps: string[] = [];
  const flush = () => {
    // Trim particles and connectors from the ends.
    while (piece.length && piece[0].kind !== "cap") {
      piece.shift();
      pieceGaps.shift();
    }
    while (piece.length && piece[piece.length - 1].kind !== "cap") {
      piece.pop();
      pieceGaps.pop();
    }
    // "and" joins a firm's name ("Santiago and Lim LLP"), not two people.
    // "and" joins a firm's name ("Santiago and Lim LLP") or two parties;
    // with a legal suffix after it, propose the firm and both halves.
    const and = piece.findIndex(
      (t) =>
        t.kind === "amp" && t.lower === "&" && t.text.toLowerCase() === "and",
    );
    if (and > 0) {
      const firm = piece.slice(and + 1).some(isOrgWord);
      if (firm) out.push(...emit(piece, pieceGaps, []));
      const rest = piece.slice(and + 1);
      const restGaps = pieceGaps.slice(and + 1);
      piece = piece.slice(0, and);
      pieceGaps = pieceGaps.slice(0, and - 1);
      flush();
      piece = rest;
      pieceGaps = restGaps;
      flush();
      return;
    }
    if (piece.length) {
      const commaAt = pieceGaps.indexOf(", ");
      if (commaAt >= 0) {
        const left = piece.slice(0, commaAt + 1);
        const right = piece.slice(commaAt + 1);
        const leftGaps = pieceGaps.slice(0, commaAt);
        const rightGaps = pieceGaps.slice(commaAt + 1);
        const plausible =
          right.length <= 3 && !right.some(isOrgWord) && !left.some(isOrgWord);
        const capsLeft =
          left.length <= 3 && left.every((t) => t.kind !== "cap" || t.caps);
        if (plausible && capsLeft)
          out.push(...emit(piece, pieceGaps, ["reordered"]));
        else {
          if (
            plausible &&
            left.length === 1 &&
            right.length <= 2 &&
            endsSegment
          )
            out.push(...emit(piece, pieceGaps, ["reordered"]));
          out.push(...emit(left, leftGaps, []));
          out.push(...emit(right, rightGaps, []));
        }
      } else out.push(...emit(piece, pieceGaps, []));
    }
    piece = [];
    pieceGaps = [];
  };
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    // A vessel prefix ends the run: "FREIGHT MV SANTA LEONOR".
    if (VESSEL_START.has(tok.text)) break;
    if (isStop(tok)) {
      flush();
      continue;
    }
    if (piece.length) pieceGaps.push(gaps[i - 1] ?? " ");
    piece.push(tok);
  }
  flush();
  return out;
}

function emit(toks: Tok[], gaps: string[], signals: string[]): Proposal[] {
  if (toks.length === 0) return [];
  const caps = toks.filter((t) => t.kind === "cap");
  if (caps.length === 0) return [];
  const first = toks[0];
  if (VESSEL_START.has(first.text) || PLACE_START.has(first.lower)) return [];
  if (toks.some((t) => DECOY_WORDS.has(t.lower.replace(/\.$/, "")))) return [];
  if (caps.every((t) => isHonorific(t) || isOrgWord(t))) return [];
  const words = caps.filter((t) => !isHonorific(t));
  const honorific = isHonorific(first);
  const hyphenated =
    toks.length === 1 &&
    /^\p{Lu}\p{Ll}+-\p{Lu}\p{Ll}+$|^(al|el|bin|ibn|abu)-\p{Lu}/u.test(
      first.text,
    );
  if (toks.length === 1 && !hyphenated) return [];
  if (toks.length > 7) return [];
  if (
    !caps.some(isOrgWord) &&
    caps.every((t) => t.caps && t.text.replace(/\P{L}/gu, "").length <= 2)
  )
    return [];
  let text = toks[0].text;
  for (let i = 1; i < toks.length; i++)
    text += (gaps[i - 1] ?? " ") + toks[i].text;
  const org = toks.some(isOrgWord);
  const initials = toks.some((t) => /^\p{Lu}\.$/u.test(t.text));
  const type: EntityType | "unknown" = org
    ? "organization"
    : honorific ||
        initials ||
        signals.includes("reordered") ||
        (words.length >= 2 && words.length <= 4)
      ? "person"
      : "unknown";
  const tags = [...signals];
  if (honorific) tags.push("honorific");
  if (initials) tags.push("initials");
  if (org) tags.push("suffix");
  if (toks.every((t) => t.kind !== "cap" || t.caps)) tags.push("caps");
  else tags.push("capitalised");
  return [{ text, type, signals: tags }];
}

/** A label's value: everything up to a column gap, an email, a bracket or a semicolon. */
function labelValues(label: string, value: string): string[] {
  let v = value.split(/\s{2,}|<|\(|;|\s-\s|\s\|\s/)[0].trim();
  v = v
    .replace(/^(to the order of|to order of)\s+/i, "")
    .replace(/[,:;]+$/, "")
    .replace(/(\S+)\.$/, (word, stem: string) =>
      KEEP_DOT.test(word) ? word : stem,
    );
  // "Name, Job Title": drop a trailing part that reads as words, not a name.
  const comma = v.indexOf(", ");
  if (comma > 0 && !LIST_LABELS.has(label)) {
    const after = v.slice(comma + 2).split(/\s+/);
    if (after.some((w) => STOP.has(w.toLowerCase()) || /^\p{Ll}/u.test(w)))
      v = v.slice(0, comma);
  }
  const pieces = LIST_LABELS.has(label) ? v.split(/,\s+|\s+and\s+/) : [v];
  return pieces
    .map((p) => p.trim())
    .filter((p) => {
      const words = p.split(/\s+/);
      if (words.length < 2 || words.length > 6) return false;
      if (BIC.test(p) || /\d/.test(p)) return false;
      return words.some(
        (w) => /\p{L}{2,}/u.test(w) && !STOP.has(w.toLowerCase()),
      );
    });
}

// The sweep ------------------------------------------------------------------------------

type Acc = {
  text: string;
  type: EntityType | "unknown";
  pages: Set<number>;
  count: number;
  signals: Set<string>;
  order: number;
};

function boilerplate(pages: string[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = normaliseLine(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, pages.length * 0.5);
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k));
}

const MONTH_RE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
function normaliseLine(line: string): string {
  return line.trim().replace(MONTH_RE, "#").replace(/\d+/g, "#");
}

/**
 * Proposes every string on the Document that may be a Name. High recall:
 * capitalised and ALL CAPS runs with particles, "SURNAME, Given", initials,
 * titles, legal suffixes, labelled fields and SWIFT party fields, email
 * handles, and names broken across a line or a page. Respects the
 * Rulebook's exclude list, entity types, officials and handles.
 */
export function sweep(doc: DocumentText, rulebook: Rulebook): Candidate[] {
  const acc = new Map<string, Acc>();
  let order = 0;
  const add = (p: Proposal, pages: number[], extra?: string) => {
    const text = p.text.trim().replace(/\s+/g, " ");
    if (!text) return;
    let entry = acc.get(text);
    if (!entry) {
      entry = {
        text,
        type: p.type,
        pages: new Set(),
        count: 0,
        signals: new Set(),
        order: order++,
      };
      acc.set(text, entry);
    }
    entry.count++;
    for (const page of pages) entry.pages.add(page);
    for (const s of p.signals) entry.signals.add(s);
    if (extra) entry.signals.add(extra);
    if (entry.type === "unknown" && p.type !== "unknown") entry.type = p.type;
  };

  const pages = doc.pages.map((p) => p.split("\n"));
  const fixed = boilerplate(pages);
  const lineRuns = pages.map((lines) => lines.map(runsOf));

  pages.forEach((lines, pageIndex) => {
    const page = pageIndex + 1;
    lines.forEach((line, lineIndex) => {
      const runs = lineRuns[pageIndex][lineIndex];
      // Column gaps (two or more spaces) end a run: tokens are re-split by segment.
      for (const run of runs) {
        const endsSegment =
          /^\s{2,}|^\s*$/.test(run.trailing) || run.trailing.startsWith("  ");
        for (const p of namesInRun(run.toks, run.gaps, endsSegment))
          add(p, [page]);
      }

      const label = LABEL.exec(line);
      if (label) {
        const key = (label[1] ?? label[3]).toLowerCase();
        for (const value of labelValues(key, label[2] ?? label[4])) {
          if (!value.includes(" ")) continue;
          add({ text: value, type: "unknown", signals: [`label:${key}`] }, [
            page,
          ]);
        }
      }
      const swift = SWIFT_PARTY.exec(line);
      if (swift) {
        const next = lines[lineIndex + 1]?.trim();
        if (
          next &&
          !/^[:/]/.test(next) &&
          !BIC.test(next) &&
          next.includes(" ")
        )
          add({ text: next, type: "unknown", signals: [`swift:${swift[1]}`] }, [
            page,
          ]);
      }
      if (rulebook.includeHandles && line.includes("@")) {
        EMAIL.lastIndex = 0;
        for (let m = EMAIL.exec(line); m; m = EMAIL.exec(line)) {
          const local = m[1];
          if (
            GENERIC_MAILBOX.has(local.toLowerCase()) ||
            !/[a-z]{3}/i.test(local)
          )
            continue;
          add(
            {
              text: local,
              type: /[._]/.test(local) ? "person" : "unknown",
              signals: ["email"],
            },
            [page],
          );
        }
      }

      // A name broken across two lines of the same paragraph.
      const nextRuns = lineRuns[pageIndex][lineIndex + 1];
      const tail = runs[runs.length - 1];
      const head = nextRuns?.[0];
      if (
        tail &&
        head &&
        head.start === leading(lines[lineIndex + 1]) &&
        joinable(line, tail)
      ) {
        join(tail, head, [page], "line-join");
      }
    });
  });

  // A name broken across a page break: last body line, first body line of the next page.
  for (let p = 0; p + 1 < pages.length; p++) {
    const last = lastBody(pages[p], fixed);
    const first = firstBody(pages[p + 1], fixed);
    if (last < 0 || first < 0) continue;
    const tail = lineRuns[p][last].at(-1);
    const head = lineRuns[p + 1][first][0];
    if (
      tail &&
      head &&
      head.start === leading(pages[p + 1][first]) &&
      joinable(pages[p][last], tail)
    )
      join(tail, head, [p + 1, p + 2], "page-join");
  }

  function join(tail: Run, head: Run, at: number[], signal: string) {
    // Only the last few tokens of the tail and the first few of the head.
    const t = tail.toks.slice(-3);
    const tg = tail.gaps.slice(tail.gaps.length - (t.length - 1));
    const h = head.toks.slice(0, 3);
    const hg = head.gaps.slice(0, h.length - 1);
    const toks = [...t, ...h];
    const gaps = [...tg, " ", ...hg];
    for (const proposal of namesInRun(toks, gaps, false)) {
      // Keep only proposals that actually cross the break.
      if (
        proposal.text.includes(t[t.length - 1].text) &&
        proposal.text.includes(h[0].text)
      )
        add(proposal, at, signal);
    }
  }

  const excluded = rulebook.exclude.map((e) => e.trim().toLowerCase());
  const out: Candidate[] = [];
  for (const entry of [...acc.values()].sort((a, b) => a.order - b.order)) {
    const lower = entry.text.toLowerCase();
    if (excluded.some((e) => lower === e || containsPhrase(lower, e))) continue;
    if (entry.type !== "unknown" && !rulebook.entityTypes.includes(entry.type))
      continue;
    if (!rulebook.includeOfficials && OFFICIAL.test(entry.text)) continue;
    out.push({
      text: entry.text,
      typeGuess: entry.type,
      pages: [...entry.pages].sort((a, b) => a - b),
      count: entry.count,
      signals: [...entry.signals],
    });
  }
  return out;
}

function containsPhrase(text: string, phrase: string): boolean {
  const at = text.indexOf(phrase);
  if (at < 0) return false;
  const before = at === 0 || /\W/.test(text[at - 1]);
  const after =
    at + phrase.length === text.length || /\W/.test(text[at + phrase.length]);
  return before && after;
}

const leading = (line: string | undefined) =>
  line ? line.length - line.trimStart().length : -1;

/** The run reaches the end of its line and the line does not end a sentence. */
function joinable(line: string, run: Run): boolean {
  const last = run.toks.at(-1);
  if (!last || run.end !== line.trimEnd().length) return false;
  if (/[!?:;]$/.test(line.trimEnd())) return false;
  // "R." ends a line inside a name; "Okafor." ends a sentence.
  if (/^\p{Lu}\.$/u.test(last.text)) return true;
  return last.end !== true;
}

function lastBody(lines: string[], fixed: Set<string>): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const key = normaliseLine(lines[i]);
    if (key && !fixed.has(key)) return i;
  }
  return -1;
}

function firstBody(lines: string[], fixed: Set<string>): number {
  for (let i = 0; i < lines.length; i++) {
    const key = normaliseLine(lines[i]);
    if (key && !fixed.has(key)) return i;
  }
  return -1;
}
