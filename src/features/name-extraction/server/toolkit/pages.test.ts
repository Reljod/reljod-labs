import { describe, expect, it } from "vitest";
import { readPages } from "./pages";
import { RUN_LIMITS } from "./state";

const document = {
  id: "doc",
  title: "Doc",
  pages: [
    "one",
    "two",
    "x".repeat(RUN_LIMITS.charsPerRead),
    "four",
    "five",
    "six",
    "seven",
    "eight",
  ],
};

describe("readPages", () => {
  it("returns whole pages and counts them as read", () => {
    const result = readPages(document, { from: 1, to: 2 });
    expect(result.read).toEqual([1, 2]);
    expect(result.text).toContain("=== Page 2 ===\ntwo");
  });

  it("does not count a page cut to fit", () => {
    const result = readPages(document, { from: 2, to: 4 });
    expect(result.read).toEqual([2, 4]);
    expect(result.text).toContain("NOT counted as read");
  });

  it("refuses too many pages or pages outside the Document", () => {
    expect(
      readPages(document, { from: 1, to: RUN_LIMITS.pagesPerRead + 1 }).read,
    ).toEqual([]);
    expect(readPages(document, { from: 0, to: 1 }).text).toMatch(/refused/);
    expect(readPages(document, { from: 8, to: 9 }).text).toMatch(/refused/);
  });
});
