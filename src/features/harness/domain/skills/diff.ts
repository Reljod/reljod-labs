/** One line of a diff: kept, added in the new text, or removed from the old. */
export type DiffLine = {
  kind: "same" | "add" | "remove";
  text: string;
};

/** Texts longer than this many lines are not diffed line by line (the table would be too big). */
export const DIFF_MAX_LINES = 1500;

/**
 * A simple line diff (longest common subsequence). Returns the lines in
 * reading order, each marked kept, added or removed. Past `DIFF_MAX_LINES` it
 * falls back to "all old removed, all new added" rather than build a huge
 * table.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  // Trim what both ends share: most edits touch the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a
    .slice(0, start)
    .map((text): DiffLine => ({ kind: "same", text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: "same", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);

  if (x.length > DIFF_MAX_LINES || y.length > DIFF_MAX_LINES) {
    return [
      ...head,
      ...x.map((text): DiffLine => ({ kind: "remove", text })),
      ...y.map((text): DiffLine => ({ kind: "add", text })),
      ...tail,
    ];
  }

  const width = y.length + 1;
  const table = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      table[i * width + j] =
        x[i] === y[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(
              table[(i + 1) * width + j] ?? 0,
              table[i * width + j + 1] ?? 0,
            );
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      middle.push({ kind: "same", text: x[i] as string });
      i++;
      j++;
    } else if (
      (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)
    ) {
      middle.push({ kind: "remove", text: x[i] as string });
      i++;
    } else {
      middle.push({ kind: "add", text: y[j] as string });
      j++;
    }
  }
  for (; i < x.length; i++)
    middle.push({ kind: "remove", text: x[i] as string });
  for (; j < y.length; j++) middle.push({ kind: "add", text: y[j] as string });
  return [...head, ...middle, ...tail];
}

/** How many lines were added and removed. */
export function diffStats(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added++;
    else if (line.kind === "remove") removed++;
  }
  return { added, removed };
}
