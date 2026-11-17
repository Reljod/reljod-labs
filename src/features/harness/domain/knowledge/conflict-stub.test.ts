import { describe, expect, it } from "vitest";
import { stubVerdicts } from "./conflicts";
import { SEED_SOURCES, seedPassages } from "./seed";

// The Circular's one page, as the PDF reader gives it (lines wrapped).
const CIRCULAR = {
  sourceTitle: "kb-pensions-circular-2023-07",
  documentDate: "2023-12-01",
  heading: "Page 1",
  body: `HARBOUR BANK & TRUST
Pensions Circular 2023-07 (SPECIMEN, a fictional bank)
Date: 1 December 2023
Subject: Property withdrawals: new maximum amounts from 9 December 2023
2. From 9 December 2023 the most a Caymanian may withdraw from mandatory pension money
for housing is CI$50,000 for a deposit or a reduction payment on an existing mortgage,
and CI$100,000 to pay off an existing mortgage in full. The amounts are measured across
all of the person's plans.
3. The previous maximum of CI$35,000 no longer applies to an application made on or
after 9 December 2023.
4. The application fee, if one is charged, is at most CI$50. The cheque is paid to the
lender, never to the member.`,
};

const seedCandidates = SEED_SOURCES.flatMap((source) =>
  seedPassages(source).map((passage) => ({
    key: source.key,
    sourceTitle: source.title,
    documentDate: source.documentDate,
    heading: passage.heading,
    body: passage.body,
  })),
);

describe("stubVerdicts (the e2e Conflict check)", () => {
  it("finds the Circular against the Member Guide's CI$35,000 cap, and only that", () => {
    const verdicts = stubVerdicts(CIRCULAR, seedCandidates);
    const hits = verdicts
      .filter((verdict) => verdict.conflicts)
      .map((verdict) => seedCandidates[verdict.candidate - 1]);
    expect(hits.map((hit) => hit?.key)).toEqual(["member-guide"]);
    const verdict = verdicts.find((entry) => entry.conflicts);
    expect(verdict?.proposal).toBe("supersede");
    expect(verdict?.summary).toContain("CI$35,000");
  });

  it("sees no Conflict where the amounts agree or the subject differs", () => {
    const passage = (body: string, documentDate = "2024-01-01") => ({
      sourceTitle: "x",
      documentDate,
      heading: "Property withdrawals",
      body,
    });
    const cap50 = passage(
      "A Caymanian may withdraw for housing a deposit of up to CI$50,000 on a mortgage.",
    );
    const sameCap = passage(
      "For housing a Caymanian may withdraw a deposit of at most CI$50,000 on a mortgage.",
    );
    const otherSubject = passage(
      "The application fee is at most CI$50 when an officer reviews it.",
    );
    expect(stubVerdicts(cap50, [sameCap, otherSubject])).toMatchObject([
      { candidate: 1, conflicts: false },
      { candidate: 2, conflicts: false },
    ]);
    const cap35 = passage(
      "A Caymanian may withdraw for housing a deposit of up to CI$35,000 on a mortgage.",
      "2025-01-01",
    );
    expect(stubVerdicts(cap50, [cap35])[0]).toMatchObject({
      conflicts: true,
      proposal: "set_aside",
    });
  });

  it("does not take one case's figure for a rule", () => {
    const letter = {
      sourceTitle: "request-property-missing-letter",
      documentDate: "2026-11-01",
      heading: "Property withdrawal application",
      body: "Caymanian member applies to withdraw pension money for a housing deposit on a mortgage. Amount requested: CI$40,000.00 for the deposit on the mortgage of my home.",
    };
    expect(
      stubVerdicts(letter, seedCandidates).filter(
        (verdict) => verdict.conflicts,
      ),
    ).toEqual([]);
  });
});
