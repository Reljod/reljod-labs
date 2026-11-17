/**
 * Scores a Run's Names against a Corpus Document's Answer key. Recall is the
 * headline: a missed name is a missed screening hit.
 */
import type { ExtractedName, Score } from "./contract";
import type { ExpectedName } from "./corpus";
import { sameParty } from "./resolve";

/** A found Name paired with the expected Name it counts for. */
export type NamePair = { found: ExtractedName; expected: ExpectedName };

export type NameMatch = {
  /** One-to-one pairs, in Answer key order. */
  pairs: NamePair[];
  /** Expected Names no found Name counts for, in Answer key order. */
  missed: ExpectedName[];
  /** Found Names that count for no expected Name, in Register order. */
  extra: ExtractedName[];
};

/**
 * Pairs found Names with expected ones. A found Name matches an expected one
 * when its canonical form or any alias names the same party as the expected
 * canonical form or any of its aliases. Matching is one-to-one (a maximum
 * bipartite matching), so one found Name never counts for two expected ones.
 */
export function matchNames(
  found: ExtractedName[],
  expected: ExpectedName[],
): NameMatch {
  const edges: number[][] = expected.map((e) => {
    const want = [e.canonical, ...e.aliases];
    const out: number[] = [];
    found.forEach((f, j) => {
      const have = [f.canonical, ...f.aliases];
      if (want.some((w) => have.some((h) => sameParty(w, h)))) out.push(j);
    });
    return out;
  });
  const owner = new Array<number>(found.length).fill(-1);
  const augment = (i: number, seen: boolean[]): boolean => {
    for (const j of edges[i]) {
      if (seen[j]) continue;
      seen[j] = true;
      if (owner[j] === -1 || augment(owner[j], seen)) {
        owner[j] = i;
        return true;
      }
    }
    return false;
  };
  // Expected names with fewer options go first; the result is maximal either way.
  const order = expected
    .map((_, i) => i)
    .sort((a, b) => edges[a].length - edges[b].length);
  for (const i of order)
    augment(i, new Array<boolean>(found.length).fill(false));
  const partner = new Array<number>(expected.length).fill(-1);
  owner.forEach((i, j) => {
    if (i !== -1) partner[i] = j;
  });
  return {
    pairs: expected.flatMap((e, i) =>
      partner[i] === -1 ? [] : [{ found: found[partner[i]], expected: e }],
    ),
    missed: expected.filter((_, i) => partner[i] === -1),
    extra: found.filter((_, j) => owner[j] === -1),
  };
}

export function scoreNames(
  found: ExtractedName[],
  expected: ExpectedName[],
): Score {
  return scoreMatch(matchNames(found, expected), found.length, expected.length);
}

/** The Score of a match already made (see matchNames). */
export function scoreMatch(
  match: NameMatch,
  found: number,
  expected: number,
): Score {
  const truePositives = match.pairs.length;
  return {
    expected,
    found,
    truePositives,
    recall: expected === 0 ? 1 : truePositives / expected,
    precision: found === 0 ? (expected === 0 ? 1 : 0) : truePositives / found,
    missed: match.missed.map((e) => e.canonical),
  };
}
