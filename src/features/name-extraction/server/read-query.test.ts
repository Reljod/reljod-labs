import { describe, expect, it } from "vitest";
import { overviewQuery, pagesQuery, sourceOf } from "./read-query";

const UPLOAD = "22222222-2222-4222-8222-222222222222";
const q = (query: string) => new URLSearchParams(query);

describe("sourceOf", () => {
  it("reads a demo Document", () => {
    expect(sourceOf(q("corpus=ne-te-01"))).toEqual({
      kind: "corpus",
      corpusId: "ne-te-01",
    });
  });

  it("reads an Upload by its uuid", () => {
    expect(sourceOf(q(`upload=${UPLOAD}`))).toEqual({
      kind: "upload",
      uploadId: UPLOAD,
    });
  });

  it("refuses an Upload id that is not a uuid, both kinds at once, or none", () => {
    expect(sourceOf(q("upload=../../etc"))).toBeNull();
    expect(sourceOf(q(`corpus=ne-te-01&upload=${UPLOAD}`))).toBeNull();
    expect(sourceOf(q(""))).toBeNull();
    expect(sourceOf(q(`corpus=${"x".repeat(41)}`))).toBeNull();
  });
});

describe("overviewQuery", () => {
  it("passes a Run id through and leaves its shape to the repository", () => {
    expect(overviewQuery(q("run=abc"))).toEqual({ source: null, runId: "abc" });
  });

  it("has no Run without one", () => {
    expect(overviewQuery(q("corpus=ne-te-01"))).toEqual({
      source: { kind: "corpus", corpusId: "ne-te-01" },
    });
  });

  it("refuses an absurdly long Run id", () => {
    expect(overviewQuery(q(`run=${"a".repeat(101)}`))).toEqual({
      error: "No such Run.",
    });
  });
});

describe("pagesQuery", () => {
  it("reads the range as integers", () => {
    expect(pagesQuery(q("corpus=ne-te-01&from=13&to=24"))).toEqual({
      source: { kind: "corpus", corpusId: "ne-te-01" },
      from: 13,
      to: 24,
    });
  });

  it.each([
    "corpus=ne-te-01",
    "corpus=ne-te-01&from=1",
    "corpus=ne-te-01&from=0&to=12",
    "corpus=ne-te-01&from=1.5&to=12",
    "corpus=ne-te-01&from=a&to=12",
  ])("refuses a bad range: %s", (query) => {
    expect(pagesQuery(q(query))).toEqual({
      error: "Ask for pages from 1 up, in order.",
    });
  });
});
