import { describe, expect, it } from "vitest";
import {
  EVENT_OVERLAP,
  readFrom,
  startCursor,
  takeFresh,
} from "./event-cursor";

const events = (...seqs: number[]) => seqs.map((seq) => ({ seq }));

describe("event cursor", () => {
  it("starts at the client's after and reads back the overlap", () => {
    expect(readFrom(startCursor(120))).toBe(120 - EVENT_OVERLAP);
    expect(readFrom(startCursor(10))).toBe(0);
    expect(startCursor(Number.NaN).after).toBe(0);
    expect(startCursor(-4).after).toBe(0);
  });

  it("sends each event once and advances to the highest seq sent", () => {
    let cursor = startCursor(0);
    const first = takeFresh(cursor, events(1, 2, 3));
    expect(first.fresh.map((event) => event.seq)).toEqual([1, 2, 3]);
    cursor = first.cursor;
    expect(cursor.after).toBe(3);
    const again = takeFresh(cursor, events(1, 2, 3, 4));
    expect(again.fresh.map((event) => event.seq)).toEqual([4]);
    expect(again.cursor.after).toBe(4);
  });

  it("sends an event that committed after a higher seq was sent", () => {
    // Seqs 10 and 12 are committed; 11 (a parallel insert) commits later.
    let cursor = takeFresh(startCursor(9), events(10, 12)).cursor;
    expect(cursor.after).toBe(12);
    expect(readFrom(cursor)).toBeLessThan(11);
    const late = takeFresh(cursor, events(10, 11, 12, 13));
    expect(late.fresh.map((event) => event.seq)).toEqual([11, 13]);
    cursor = late.cursor;
    expect(cursor.after).toBe(13);
  });

  it("returns fresh events in seq order", () => {
    const { fresh } = takeFresh(startCursor(0), events(5, 3, 4));
    expect(fresh.map((event) => event.seq)).toEqual([3, 4, 5]);
  });

  it("forgets seqs that fell behind the overlap window", () => {
    const cursor = takeFresh(startCursor(0), events(1, 2, 200)).cursor;
    expect([...cursor.sent]).toEqual([200]);
    // Rows behind the window are never read again, so forgetting is safe.
    expect(readFrom(cursor)).toBe(200 - EVENT_OVERLAP);
  });

  it("moves the cursor forward on a full page, so paging ends", () => {
    const page = Array.from({ length: 500 }, (_, index) => ({
      seq: index + 1,
    }));
    const { cursor } = takeFresh(startCursor(0), page);
    expect(readFrom(cursor)).toBeGreaterThan(400);
  });
});
