import { describe, expect, it } from "vitest";
import { drumPosition } from "./drum";

describe("drum position", () => {
  const turn = [0.1, 0.9] as const;

  it("starts on the first card and ends on the last", () => {
    expect(drumPosition(0, 7, turn)).toBe(0);
    expect(drumPosition(1, 7, turn)).toBe(6);
  });

  it("lands exactly on each card at its point of the turn", () => {
    for (let card = 0; card < 7; card++) {
      const p = turn[0] + (card / 6) * (turn[1] - turn[0]);
      expect(drumPosition(p, 7, turn)).toBeCloseTo(card, 6);
    }
  });

  it("dwells near a card: a little past it barely moves", () => {
    const at = turn[0] + (2 / 6) * (turn[1] - turn[0]);
    expect(drumPosition(at + 0.01, 7, turn) - 2).toBeLessThan(0.05);
  });

  it("only moves forward", () => {
    let last = -1;
    for (let p = 0; p <= 1; p += 0.01) {
      const now = drumPosition(p, 7, turn);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });
});
