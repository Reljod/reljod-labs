/**
 * Where a live stream of a Run's Audit trail is, and which events it has
 * sent. Pure, so the events route's cursor logic is tested on its own.
 *
 * `seq` is a global identity, taken when a row is inserted, not when its
 * transaction commits. Readers insert in parallel, so an event can commit
 * after one with a higher seq that the stream has already sent. A plain
 * `seq > after` cursor would skip it for good. So each poll reads again from
 * a little behind the cursor (`EVENT_OVERLAP` seqs) and drops what it has
 * already sent; the client dedupes by seq too.
 */

/** How far behind the cursor each poll reads again, in seqs. */
export const EVENT_OVERLAP = 50;

export type EventCursor = {
  /** The highest seq sent so far (or the client's `after`). */
  after: number;
  /** Seqs sent within the overlap window. */
  sent: ReadonlySet<number>;
};

export function startCursor(after: number): EventCursor {
  return { after: Math.max(0, Math.trunc(after) || 0), sent: new Set() };
}

/** The seq to read after (exclusive) on the next poll. */
export function readFrom(cursor: EventCursor) {
  return Math.max(0, cursor.after - EVENT_OVERLAP);
}

/**
 * The events of a page (read with `seq > readFrom(cursor)`) not sent yet, in
 * seq order, and the cursor after sending them. Seqs that fell out of the
 * overlap window are forgotten, so the set stays small.
 */
export function takeFresh<T extends { seq: number }>(
  cursor: EventCursor,
  page: readonly T[],
): { fresh: T[]; cursor: EventCursor } {
  const fresh = page
    .filter((event) => !cursor.sent.has(event.seq))
    .sort((a, b) => a.seq - b.seq);
  const after = fresh.reduce(
    (max, event) => Math.max(max, event.seq),
    cursor.after,
  );
  const floor = after - EVENT_OVERLAP;
  const sent = new Set<number>();
  for (const seq of cursor.sent) if (seq > floor) sent.add(seq);
  for (const event of fresh) if (event.seq > floor) sent.add(event.seq);
  return { fresh, cursor: { after, sent } };
}
