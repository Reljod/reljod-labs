import { describe, expect, it } from "vitest";
import { parseUploadPages, UPLOAD_LIMITS } from "./upload";

describe("parseUploadPages", () => {
  it("accepts pages of text", () => {
    expect(parseUploadPages({ pages: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("refuses what an Upload may not hold", () => {
    expect(() => parseUploadPages({})).toThrow(/no pages/);
    expect(() => parseUploadPages({ pages: [1] })).toThrow(/not text/);
    expect(() =>
      parseUploadPages({ pages: new Array(UPLOAD_LIMITS.pages + 1).fill("x") }),
    ).toThrow(/over 500 pages/);
    expect(() =>
      parseUploadPages({ pages: ["x".repeat(UPLOAD_LIMITS.charsPerPage + 1)] }),
    ).toThrow(/over 20,000 characters/);
  });
});
