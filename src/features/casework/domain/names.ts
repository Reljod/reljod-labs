import { words } from "@/features/document-compliance/domain/matching";

export { words };

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "hon", "sir", "the"]);

/** Name words without titles, accents or punctuation. */
export function nameWords(name: string): string[] {
  return words(name).filter((word) => !TITLES.has(word));
}

/** Jaro-Winkler similarity of two words, 0 to 1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function bestWordMatch(word: string, candidates: string[]) {
  let best = 0;
  for (const candidate of candidates) {
    if (word.length === 1 || candidate.length === 1) {
      if (word[0] === candidate[0]) best = Math.max(best, 0.85);
      continue;
    }
    best = Math.max(best, jaroWinkler(word, candidate));
  }
  return best;
}

/**
 * How alike two names are, 0 to 100, ignoring order, accents and initials. Each
 * word of the shorter name is matched to its closest word in the longer one,
 * so "Liang Zhi Wei" and "Zhiwei Liang" score well, and a missing middle name
 * costs less than a different surname.
 */
export function nameScore(a: string, b: string): number {
  const left = nameWords(a);
  const right = nameWords(b);
  if (left.length === 0 || right.length === 0) return 0;
  const joinedLeft = left.join("");
  const joinedRight = right.join("");
  if (joinedLeft === joinedRight) return 100;
  const [short, long] =
    left.length <= right.length ? [left, right] : [right, left];
  // Run-together names: "zhiwei" against "zhi wei".
  const longJoined = long.join("");
  const scores = short.map((word) =>
    Math.max(
      bestWordMatch(word, long),
      word.length > 3 && longJoined.includes(word) ? 0.95 : 0,
    ),
  );
  const average = scores.reduce((sum, score) => sum + score, 0) / short.length;
  // Penalise long names with many unmatched words, gently.
  const coverage = Math.min(1, (short.length + 1) / (long.length + 1));
  return Math.round(average * (0.85 + 0.15 * coverage) * 100);
}

/** True when two names plausibly belong to the same person. */
export function sameName(a: string, b: string, threshold = 88) {
  return nameScore(a, b) >= threshold;
}

/**
 * True when the surname changed but the given names agree: "Lorna Dacosta"
 * and "Lorna Merren", the shape of a marriage.
 */
export function surnameChanged(a: string, b: string) {
  const left = nameWords(a);
  const right = nameWords(b);
  if (left.length < 2 || right.length < 2) return false;
  const leftLast = left.at(-1) ?? "";
  const rightLast = right.at(-1) ?? "";
  if (jaroWinkler(leftLast, rightLast) > 0.9) return false;
  return jaroWinkler(left[0] ?? "", right[0] ?? "") > 0.92;
}
