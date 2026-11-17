/**
 * Scores a Run's Names against a Corpus Document's Answer key. Recall is the
 * headline: a missed name is a missed screening hit.
 */
import type { ExtractedName, Score } from "./contract";
import type { ExpectedName } from "./corpus";
import { sameParty } from "./resolve";

/**
 * A found Name matches an expected one when its canonical form or any alias
 * names the same party as the expected canonical form or any of its aliases.
 * Matching is one-to-one (a maximum bipartite matching), so one found Name
 * never counts for two expected ones.
 */
export function scoreNames(
  found: ExtractedName[],
  expected: ExpectedName[],
): Score {
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
  const matched = new Array<boolean>(expected.length).fill(false);
  // Expected names with fewer options go first; the result is maximal either way.
  const order = expected
    .map((_, i) => i)
    .sort((a, b) => edges[a].length - edges[b].length);
  for (const i of order)
    matched[i] = augment(i, new Array<boolean>(found.length).fill(false));
  const truePositives = matched.filter(Boolean).length;
  return {
    expected: expected.length,
    found: found.length,
    truePositives,
    recall: expected.length === 0 ? 1 : truePositives / expected.length,
    precision:
      found.length === 0
        ? expected.length === 0
          ? 1
          : 0
        : truePositives / found.length,
    missed: expected.filter((_, i) => !matched[i]).map((e) => e.canonical),
  };
}
