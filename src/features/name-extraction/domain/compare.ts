/**
 * A Run's Names set against the Answer key, row by row, for people who read
 * the result rather than the Score: who was found, who was missed, and what
 * the Run found that the key does not have. Pure.
 */
import type {
  Comparison,
  ComparisonRow,
  ExtractedName,
  HardReason,
  MarkStatus,
} from "./contract";
import type { ExpectedName } from "./corpus";
import { matchNames, type NameMatch, scoreMatch } from "./score";

const ORDER: Record<ComparisonRow["status"], number> = {
  missed: 0,
  found: 1,
  extra: 2,
};

/** Pages a found Name was quoted on, ascending, once each. */
export function runPages(name: ExtractedName): number[] {
  return [...new Set(name.mentions.map((m) => m.page))].sort((a, b) => a - b);
}

/**
 * How each side's Names stand, for the marks: an expected Name is `found` or
 * `missed`; a found Name is `found` (shown under the key's canonical form)
 * or `extra`. With no Answer key (an Upload) every found Name is `found`.
 */
export type Standing = {
  match: NameMatch | null;
  expected(name: ExpectedName): MarkStatus;
  found(name: ExtractedName): { name: string; status: MarkStatus };
};

export function standing(
  found: ExtractedName[],
  expected: ExpectedName[] | null,
): Standing {
  if (!expected)
    return {
      match: null,
      expected: () => "expected",
      found: (name) => ({ name: name.canonical, status: "found" }),
    };
  const match = matchNames(found, expected);
  const keyOf = new Map(match.pairs.map((p) => [p.found, p.expected]));
  const foundKeys = new Set(match.pairs.map((p) => p.expected));
  return {
    match,
    expected: (name) => (foundKeys.has(name) ? "found" : "missed"),
    found: (name) => {
      const key = keyOf.get(name);
      return key
        ? { name: key.canonical, status: "found" }
        : { name: name.canonical, status: "extra" };
    },
  };
}

/**
 * The rows of a Run's comparison: missed first, then found, then extra, each
 * group by first page then name. `hard` holds the canonical forms of the
 * parties the corpus prints only in damaged forms.
 */
export function compareNames(
  found: ExtractedName[],
  expected: ExpectedName[] | null,
  hard: ReadonlySet<string> | ReadonlyMap<string, HardReason> = new Set(),
): Comparison {
  /** `{ hardReason }` when the damage is known, else nothing (rows stay as they were). */
  const reason = (canonical: string) => {
    const kind = hard instanceof Map ? hard.get(canonical) : undefined;
    return kind ? { hardReason: kind } : {};
  };
  const rows: ComparisonRow[] = [];
  if (!expected) {
    for (const name of found)
      rows.push({
        name: name.canonical,
        type: name.type,
        status: "found",
        foundAs: null,
        pages: runPages(name),
        hard: false,
      });
    return { rows: sortRows(rows), score: null };
  }
  const match = matchNames(found, expected);
  for (const pair of match.pairs)
    rows.push({
      name: pair.expected.canonical,
      type: pair.expected.type,
      status: "found",
      foundAs:
        pair.found.canonical === pair.expected.canonical
          ? null
          : pair.found.canonical,
      pages: [...pair.expected.pages],
      hard: hard.has(pair.expected.canonical),
      ...reason(pair.expected.canonical),
    });
  for (const name of match.missed)
    rows.push({
      name: name.canonical,
      type: name.type,
      status: "missed",
      foundAs: null,
      pages: [...name.pages],
      hard: hard.has(name.canonical),
      ...reason(name.canonical),
    });
  for (const name of match.extra)
    rows.push({
      name: name.canonical,
      type: name.type,
      status: "extra",
      foundAs: null,
      pages: runPages(name),
      hard: false,
    });
  return {
    rows: sortRows(rows),
    score: scoreMatch(match, found.length, expected.length),
  };
}

function sortRows(rows: ComparisonRow[]) {
  return rows.sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.pages[0] ?? Number.POSITIVE_INFINITY) -
        (b.pages[0] ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name),
  );
}
