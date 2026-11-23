/**
 * A word-level diff between two drafts of the Statement, for the redlines in
 * the Review: what the Comms lead struck, what it added, what it kept.
 *
 * Words are compared without their spaces and every piece is rebuilt with a
 * single space after each word, so a run of changes reads as whole words
 * ("The cause was probably" struck, "We will publish" added) instead of two
 * sentences threaded through the spaces they share.
 */
export type Piece = { kind: "same" | "gone" | "new"; text: string };

const words = (text: string) => text.split(/\s+/).filter(Boolean);

export function diffWords(before: string, after: string): Piece[] {
  const a = words(before);
  const b = words(after);
  // Longest common subsequence table, built from the end.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i] as number[];
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const pieces: Piece[] = [];
  const push = (kind: Piece["kind"], word: string) => {
    const last = pieces[pieces.length - 1];
    if (last && last.kind === kind) last.text += `${word} `;
    else pieces.push({ kind, text: `${word} ` });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i] as string);
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      push("gone", a[i] as string);
      i++;
    } else {
      push("new", b[j] as string);
      j++;
    }
  }
  while (i < a.length) push("gone", a[i++] as string);
  while (j < b.length) push("new", b[j++] as string);
  const last = pieces[pieces.length - 1];
  if (last) last.text = last.text.trimEnd();
  return pieces;
}
