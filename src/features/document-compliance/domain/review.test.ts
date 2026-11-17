import { describe, expect, it } from "vitest";
import { checkReview, countOutcomes, diffFindings, LIMITS } from "./review";

const finding = (
  requirementId: Parameters<typeof diffFindings>[0][number]["requirementId"],
  outcome: "pass" | "fail" | "needs_review",
) => ({ requirementId, title: requirementId, outcome });

describe("diffFindings", () => {
  it("lists changed, new and dropped Findings, and nothing that stayed", () => {
    const before = [
      finding("name-matches", "needs_review"),
      finding("no-tampering", "needs_review"),
      finding("documents-legible", "pass"),
    ];
    const after = [
      finding("name-matches", "fail"),
      finding("documents-legible", "pass"),
      finding("proof-of-address-recent", "pass"),
    ];
    expect(diffFindings(before, after)).toEqual([
      {
        requirementId: "name-matches",
        title: "name-matches",
        from: "needs_review",
        to: "fail",
      },
      {
        requirementId: "proof-of-address-recent",
        title: "proof-of-address-recent",
        from: null,
        to: "pass",
      },
      {
        requirementId: "no-tampering",
        title: "no-tampering",
        from: "needs_review",
        to: null,
      },
    ]);
  });
});

describe("checkReview", () => {
  it("needs Pass or Fail and a note", () => {
    expect(checkReview({ outcome: "needs_review", note: "fine" }).ok).toBe(
      false,
    );
    expect(checkReview({ outcome: "pass", note: "  " }).ok).toBe(false);
    expect(
      checkReview({
        outcome: "fail",
        note: "x".repeat(LIMITS.noteMaxLength + 1),
      }).ok,
    ).toBe(false);
    expect(
      checkReview({ outcome: "pass", note: "  Bill is a known variant. " }),
    ).toEqual({
      ok: true,
      outcome: "pass",
      note: "Bill is a known variant.",
    });
  });
});

describe("countOutcomes", () => {
  it("counts each outcome", () => {
    expect(
      countOutcomes([
        { outcome: "pass" },
        { outcome: "fail" },
        { outcome: "pass" },
      ]),
    ).toEqual({ pass: 2, fail: 1, needs_review: 0 });
  });
});
