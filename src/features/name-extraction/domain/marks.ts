/**
 * Highlights for a previewed page: where on the page's text each Name is
 * printed. Pure; the server builds a page's marks per request.
 *
 * Search is exact: case-sensitive first, then (for a form not found that way)
 * case-insensitive. Runs of whitespace match any run of whitespace, so a name
 * the page wraps over a line break is still found; offsets point into the
 * original text. Marks never overlap: the longest span wins.
 */
import type {
  EntityType,
  ExtractedName,
  MarkStatus,
  PageMark,
} from "./contract";
import type { ExpectedName } from "./corpus";

/** At most this many marks on one page; the longest spans are kept. */
export const MAX_MARKS_PER_PAGE = 300;

/** Forms shorter than this are not searched for (they would light up noise). */
const MIN_FORM_LENGTH = 2;

/** One Name to look for on a page, with every form it may be printed in. */
export type MarkTarget = {
  name: string;
  type: EntityType;
  status: MarkStatus;
  forms: string[];
};

/** A page's text with whitespace runs folded to one space, and where each char came from. */
type Folded = { text: string; lower: string; origin: number[] };

function fold(text: string): Folded {
  let out = "";
  const origin: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inSpace) {
        out += " ";
        origin.push(i);
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    out += ch;
    origin.push(i);
  }
  return { text: out, lower: lowerSameLength(out), origin };
}

/** Lower case, one UTF-16 unit for one, so offsets survive (a char whose lower case is longer stays as is). */
function lowerSameLength(text: string) {
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

const WORD = /[\p{L}\p{N}]/u;
const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);

/** Start offsets (in the folded text) of every whole-word occurrence of `needle`. */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  const guardStart = isWord(needle[0]);
  const guardEnd = isWord(needle[needle.length - 1]);
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if (!(guardStart && isWord(before)) && !(guardEnd && isWord(after)))
      out.push(at);
    from = at + 1;
  }
  return out;
}

const foldForm = (form: string) => form.replace(/\s+/g, " ").trim();

/**
 * The marks for one page: every printed form of every target, overlaps
 * resolved (longest first, then earliest, then the earlier target), sorted by
 * start, at most `cap`.
 */
export function markPage(
  text: string,
  targets: MarkTarget[],
  cap = MAX_MARKS_PER_PAGE,
): PageMark[] {
  if (!text || targets.length === 0 || cap <= 0) return [];
  const folded = fold(text);
  type Span = PageMark & { rank: number };
  const spans: Span[] = [];
  targets.forEach((target, rank) => {
    const forms = new Set(
      target.forms
        .map(foldForm)
        .filter((form) => form.length >= MIN_FORM_LENGTH),
    );
    for (const form of forms) {
      let hits = occurrences(folded.text, form);
      if (hits.length === 0)
        hits = occurrences(folded.lower, lowerSameLength(form));
      for (const at of hits) {
        spans.push({
          start: folded.origin[at],
          end: folded.origin[at + form.length - 1] + 1,
          status: target.status,
          name: target.name,
          type: target.type,
          rank,
        });
      }
    }
  });
  spans.sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start ||
      a.rank - b.rank,
  );
  const taken = new Uint8Array(text.length);
  const kept: PageMark[] = [];
  for (const span of spans) {
    if (kept.length >= cap) break;
    let free = true;
    for (let i = span.start; i < span.end; i++)
      if (taken[i]) {
        free = false;
        break;
      }
    if (!free) continue;
    taken.fill(1, span.start, span.end);
    kept.push({
      start: span.start,
      end: span.end,
      status: span.status,
      name: span.name,
      type: span.type,
    });
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * The pieces of names the corpus broke over a page break, by page and
 * canonical form: neither page prints the whole form, so the key's view
 * looks for each piece on its own page.
 */
export type SplitPieces = Map<string, string[]>;

const pieceKey = (page: number, canonical: string) =>
  `${page}\u0000${canonical}`;

/** Collects SplitPieces from the corpus generator's record of what it printed where. */
export function splitPieces(
  mentions: { alias: string; fragments: { page: number; text: string }[] }[],
  answerKey: ExpectedName[],
): SplitPieces {
  const byForm = new Map<string, string>();
  for (const name of answerKey)
    for (const form of [name.canonical, ...name.aliases])
      if (!byForm.has(form)) byForm.set(form, name.canonical);
  const out: SplitPieces = new Map();
  for (const mention of mentions) {
    if (mention.fragments.length < 2) continue;
    const canonical = byForm.get(mention.alias);
    if (!canonical) continue;
    for (const fragment of mention.fragments) {
      const key = pieceKey(fragment.page, canonical);
      out.set(key, [...(out.get(key) ?? []), fragment.text]);
    }
  }
  return out;
}

/**
 * The answer key's marks on page `page`: every form of each expected Name the
 * key prints on that page, plus the pieces of a name broken over this page's
 * edge. `status` says how each stands (`expected` before a Run, `found` or
 * `missed` after one).
 */
export function keyMarks(
  page: number,
  text: string,
  expected: ExpectedName[],
  status: (name: ExpectedName) => MarkStatus,
  pieces: SplitPieces = new Map(),
): PageMark[] {
  return markPage(
    text,
    expected
      .filter((name) => name.pages.includes(page))
      .map((name) => ({
        name: name.canonical,
        type: name.type,
        status: status(name),
        forms: [
          name.canonical,
          ...name.aliases,
          ...(pieces.get(pieceKey(page, name.canonical)) ?? []),
        ],
      })),
  );
}

/**
 * The Run's marks on page `page`: each found Name's quotes there, plus its
 * canonical form and aliases, on the pages it was found on. `label` gives the
 * mark's name (the key's canonical form for a matched Name, so both panes
 * share a click target) and its status.
 */
export function runMarks(
  page: number,
  text: string,
  found: ExtractedName[],
  label: (name: ExtractedName) => { name: string; status: MarkStatus },
): PageMark[] {
  return markPage(
    text,
    found
      .filter((name) => name.mentions.some((m) => m.page === page))
      .map((name) => ({
        ...label(name),
        type: name.type,
        forms: [
          ...name.mentions
            .filter((m) => m.page === page)
            .map((m) => m.quote)
            .filter((quote) => isSurfaceForm(quote, name)),
          name.canonical,
          ...name.aliases,
        ],
      })),
  );
}

/** The most words a quote may have to be marked as the name itself. */
const SURFACE_FORM_WORDS = 8;

/**
 * Whether a mention's quote is the name as printed (a damaged or reordered
 * form, such as "j0seph okonkwo" or "OKAFOR, Folake"), and so worth marking
 * whole. A quote is often the sentence around the name; that one is not
 * marked, because the name inside it is found by its canonical form or an
 * alias, and marking the sentence would paint the whole line.
 */
export function isSurfaceForm(quote: string, name: ExtractedName) {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > SURFACE_FORM_WORDS) return false;
  const lower = quote.toLowerCase();
  const forms = [name.canonical, ...name.aliases].map((form) =>
    form.toLowerCase(),
  );
  // A quote that holds a known form with more around it is context, not the name.
  return !forms.some((form) => form !== lower && lower.includes(form));
}
