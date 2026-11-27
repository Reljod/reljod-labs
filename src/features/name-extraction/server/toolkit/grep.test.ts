import { describe, expect, it } from "vitest";
import { checkPattern, GREP_LIMITS, grepPages } from "./grep";

const pages = [
  "Ordering customer: ANA FERREIRA-VOS\n:59:/MR12 Lumen Harbour Ltd",
  "Nothing here.",
  "Signed by Ana Ferreira-Vos, director of Lumen Harbour Ltd.",
];

describe("grepPages", () => {
  it("finds every match with its page and counts per page", () => {
    const result = grepPages(pages, { pattern: "ferreira-vos", flags: "i" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(2);
    expect(result.perPage).toEqual({ 1: 1, 3: 1 });
    expect(result.hits.map((hit) => hit.page)).toEqual([1, 3]);
  });

  it("limits the search to a page range", () => {
    const result = grepPages(pages, { pattern: "Lumen", from: 2, to: 3 });
    expect(result.ok && result.total).toBe(1);
  });

  it("caps hits shown but counts them all", () => {
    const many = ["x ".repeat(500)];
    const result = grepPages(many, { pattern: "x", maxHits: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toHaveLength(5);
    expect(result.total).toBe(500);
    expect(result.truncated).toBe(true);
  });

  it("refuses flags other than i, m, s, u and over-long patterns", () => {
    expect(checkPattern("a", "g")).toMatch(/not allowed/);
    expect(checkPattern("a", "y")).toMatch(/not allowed/);
    expect(checkPattern("a".repeat(GREP_LIMITS.patternChars + 1))).toMatch(
      /over/,
    );
    expect(grepPages(pages, { pattern: "(" }).ok).toBe(false);
  });

  it("stops a catastrophic pattern instead of hanging", () => {
    const evil = [`${"a".repeat(40)}!`];
    const started = Date.now();
    const result = grepPages(evil, { pattern: "^(a+)+$" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/backtracking/);
    expect(Date.now() - started).toBeLessThan(GREP_LIMITS.timeoutMs + 2000);
  });

  it("does not loop on empty matches", () => {
    const result = grepPages(["abc"], { pattern: "x*" });
    expect(result.ok && result.total).toBe(0);
  });
});
