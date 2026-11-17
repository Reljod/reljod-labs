/** Small text helpers the checks share. Pure. */

/** Edit distance between two strings (insert, delete, substitute). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** A name reduced to lower-case letters and single spaces. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How far apart two names are, in letters: the smaller of the distance as
 * written and with the words sorted, so "Wright, Ann" matches "Ann Wright".
 */
export function nameDistance(a: string, b: string): number {
  const x = normaliseName(a);
  const y = normaliseName(b);
  const sorted = (value: string) => value.split(" ").sort().join(" ");
  return Math.min(levenshtein(x, y), levenshtein(sorted(x), sorted(y)));
}
