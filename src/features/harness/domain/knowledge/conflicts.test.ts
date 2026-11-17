import { describe, expect, it } from "vitest";
import {
  acceptVerdicts,
  CANDIDATES_PER_PASSAGE,
  choosePassagesToCheck,
  conflictPrompt,
  figureCount,
  guardProposal,
  MIN_SEMANTIC,
  type Neighbour,
  planResolution,
  queryOf,
  selectCandidates,
} from "./conflicts";

describe("choosePassagesToCheck", () => {
  const passages = [
    { body: "A plain paragraph with no figures." },
    { body: "Pay by the 15th, at 5% plus CI$87,000." },
    { body: "Welcome." },
    { body: "Cap is CI$50,000 and CI$100,000 from 9 December 2023." },
    { body: "Another paragraph, one figure: 60 days." },
  ];

  it("takes the Passages with the most figures first, returned in Source order", () => {
    expect(choosePassagesToCheck(passages, 2)).toEqual([1, 3]);
  });

  it("takes everything when the cap allows it, and nothing at cap zero", () => {
    expect(choosePassagesToCheck(passages, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(choosePassagesToCheck(passages, 0)).toEqual([]);
  });

  it("counts figures", () => {
    expect(figureCount("CI$35,000 and 9 Dec 2023")).toBe(3);
    expect(figureCount("none")).toBe(0);
  });
});

describe("selectCandidates", () => {
  const hit = (
    overrides: Partial<Neighbour> & { passageId: number },
  ): Neighbour => ({
    sourceId: "old",
    score: 0.03,
    semantic: 0.7,
    lexical: 0.2,
    ...overrides,
  });

  it("never compares a Source with itself", () => {
    const picked = selectCandidates(
      "new",
      [hit({ passageId: 1, sourceId: "new" }), hit({ passageId: 2 })],
      { embedded: true },
    );
    expect(picked.map((item) => item.passageId)).toEqual([2]);
  });

  it("with embeddings, keeps only close matches by meaning", () => {
    const picked = selectCandidates(
      "new",
      [
        hit({ passageId: 1, semantic: MIN_SEMANTIC - 0.01 }),
        hit({ passageId: 2, semantic: null, lexical: 0.9 }),
        hit({ passageId: 3, semantic: MIN_SEMANTIC }),
      ],
      { embedded: true },
    );
    expect(picked.map((item) => item.passageId)).toEqual([3]);
  });

  it("without embeddings, falls back to word matches", () => {
    const picked = selectCandidates(
      "new",
      [
        hit({ passageId: 1, semantic: null, lexical: 0.4 }),
        hit({ passageId: 2, semantic: null, lexical: null }),
      ],
      { embedded: false },
    );
    expect(picked.map((item) => item.passageId)).toEqual([1]);
  });

  it("takes the best few by score and drops repeats", () => {
    const hits = Array.from({ length: 8 }, (_, i) =>
      hit({ passageId: i + 1, score: i / 100 }),
    );
    const picked = selectCandidates(
      "new",
      [...hits, hit({ passageId: 8, score: 5 })],
      { embedded: true },
    );
    expect(picked).toHaveLength(CANDIDATES_PER_PASSAGE);
    expect(picked.map((item) => item.passageId)).toEqual([8, 7, 6]);
  });
});

describe("queryOf", () => {
  it("is the heading and the start of the body, one line, cut", () => {
    const query = queryOf({
      heading: "Rates",
      body: `five\n\npercent ${"x".repeat(500)}`,
    });
    expect(query.startsWith("Rates five percent")).toBe(true);
    expect(query.length).toBe(300);
  });
});

describe("conflictPrompt", () => {
  it("numbers candidates from 1 and carries both dates", () => {
    const prompt = conflictPrompt(
      {
        sourceTitle: "Circular",
        documentDate: "2023-12-01",
        heading: null,
        body: "Cap CI$50,000",
      },
      [
        {
          sourceTitle: "Member Guide",
          documentDate: "2023-03-01",
          heading: "Property",
          body: "Cap CI$35,000",
        },
      ],
    );
    expect(prompt).toContain('<candidate number="1">');
    expect(prompt).toContain("Document date: 2023-12-01");
    expect(prompt).toContain("Document date: 2023-03-01");
    expect(prompt).toContain("CI$35,000");
  });
});

describe("guardProposal", () => {
  it("does not let an older document supersede a newer one", () => {
    expect(guardProposal("supersede", "2023-01-01", "2023-12-01")).toBe(
      "set_aside",
    );
  });

  it("leaves the model's proposal alone otherwise", () => {
    expect(guardProposal("supersede", "2023-12-01", "2023-03-01")).toBe(
      "supersede",
    );
    expect(guardProposal("supersede", null, "2023-03-01")).toBe("supersede");
    expect(guardProposal("keep_both", "2023-01-01", "2023-12-01")).toBe(
      "keep_both",
    );
  });
});

describe("acceptVerdicts", () => {
  const candidates = [
    { documentDate: "2023-03-01" },
    { documentDate: "2024-01-01" },
  ];
  const verdict = (
    candidate: number,
    conflicts: boolean,
    summary = "differs",
  ) => ({
    candidate,
    conflicts,
    summary,
    proposal: "supersede" as const,
    reasoning: "newer",
  });

  it("keeps only real conflicts for candidates that exist, once each", () => {
    const accepted = acceptVerdicts(
      [
        verdict(1, true, "35,000 vs 50,000"),
        verdict(1, true, "again"),
        verdict(2, false),
        verdict(9, true),
      ],
      candidates,
      "2023-12-01",
    );
    expect(accepted).toEqual([
      {
        candidate: 0,
        summary: "35,000 vs 50,000",
        proposal: "supersede",
        reasoning: "newer",
      },
    ]);
  });

  it("drops a conflict with no summary and downgrades a supersede by an older document", () => {
    expect(
      acceptVerdicts([verdict(1, true, "  ")], candidates, "2023-12-01"),
    ).toEqual([]);
    const [second] = acceptVerdicts(
      [verdict(2, true)],
      candidates,
      "2023-12-01",
    );
    expect(second?.proposal).toBe("set_aside");
  });

  it("cuts long text to what the card holds", () => {
    const [one] = acceptVerdicts(
      [verdict(1, true, "x".repeat(2000))],
      candidates,
      null,
    );
    expect(one?.summary.length).toBeLessThan(700);
  });
});

describe("planResolution", () => {
  const open = { status: "open" as const, newPassageId: 10, oldPassageId: 3 };

  it("supersede retires the old Passage in favour of the new one", () => {
    expect(planResolution(open, "supersede")).toEqual({
      ok: true,
      supersede: { passageId: 3, by: 10 },
    });
  });

  it("set aside retires the new Passage in favour of the old one", () => {
    expect(planResolution(open, "set_aside")).toEqual({
      ok: true,
      supersede: { passageId: 10, by: 3 },
    });
  });

  it("keep both retires neither", () => {
    expect(planResolution(open, "keep_both")).toEqual({
      ok: true,
      supersede: null,
    });
  });

  it("refuses to settle a Conflict twice", () => {
    for (const resolution of ["supersede", "keep_both", "set_aside"] as const) {
      expect(
        planResolution({ ...open, status: "resolved" }, resolution),
      ).toEqual({
        ok: false,
        reason: "That Conflict has already been settled.",
      });
    }
  });
});
