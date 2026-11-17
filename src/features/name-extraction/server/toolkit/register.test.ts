import { describe, expect, it } from "vitest";
import { DEFAULT_RULEBOOK, type ExtractedName } from "../../domain/contract";
import { applyRecord, foldInto, readerNames, verifyMentions } from "./register";
import type { SweepCandidate } from "./state";

const pages = [
  "Payment ordered by Ana Lucía\nFerreira-Vos to Lumen Harbour Ltd.",
  "FERREIRA-VOS A L signed for Lumen Harbour Ltd.",
];

const name = (canonical: string, page = 2): ExtractedName => ({
  canonical,
  type: "person",
  aliases: [],
  roles: ["signatory"],
  mentions: [{ page, quote: canonical }],
  confidence: 0.8,
  foundBy: ["reader"],
});

describe("verifyMentions", () => {
  it("keeps a quote wrapped across lines and drops one not on its page", () => {
    const { kept, dropped } = verifyMentions(pages, [
      { page: 1, quote: "Ana Lucía Ferreira-Vos" },
      { page: 1, quote: "Ana Lucia Ferreira-Vos" },
      { page: 2, quote: "Lumen Harbour Ltd" },
      { page: 9, quote: "Lumen Harbour Ltd" },
    ]);
    expect(kept).toEqual([
      { page: 1, quote: "Ana Lucía Ferreira-Vos" },
      { page: 2, quote: "Lumen Harbour Ltd" },
    ]);
    expect(dropped).toBe(2);
  });

  it("drops quotes outside a Reader's own range", () => {
    const { kept, dropped } = verifyMentions(
      pages,
      [{ page: 2, quote: "Lumen Harbour Ltd" }],
      { from: 1, to: 1 },
    );
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });
});

describe("readerNames", () => {
  it("turns a Reader's answer into Names with verified mentions only", () => {
    const { names, dropped } = readerNames(
      pages,
      {
        names: [
          {
            name: "Ana Lucía Ferreira-Vos",
            type: "person",
            role: "signatory",
            quotes: [
              { page: 1, quote: "Ana Lucía Ferreira-Vos" },
              { page: 2, quote: "FERREIRA-VOS A L" },
            ],
            confidence: 0.9,
          },
          {
            name: "Invented Person",
            type: "person",
            role: "other",
            quotes: [{ page: 1, quote: "Invented Person" }],
            confidence: 0.5,
          },
        ],
      },
      { from: 1, to: 2 },
    );
    expect(names).toHaveLength(1);
    expect(names[0].aliases).toEqual(["FERREIRA-VOS A L"]);
    expect(names[0].foundBy).toEqual(["reader"]);
    expect(dropped).toBe(1);
  });
});

describe("applyRecord", () => {
  const candidates: SweepCandidate[] = [
    {
      id: 0,
      text: "Account Holder",
      typeGuess: "unknown",
      pages: [1],
      count: 1,
      signals: ["label"],
    },
  ];

  it("merges forms of one party, keeping every alias and mention", () => {
    const outcome = applyRecord({
      register: [name("Ana Lucía Ferreira-Vos", 1), name("FERREIRA-VOS A L")],
      dismissed: {},
      record: {
        merge: [{ into: "Ana Lucía Ferreira-Vos", from: ["FERREIRA-VOS A L"] }],
      },
      pages,
      candidates,
      rulebook: DEFAULT_RULEBOOK,
    });
    expect(outcome.register).toHaveLength(1);
    expect(outcome.register[0].aliases).toContain("FERREIRA-VOS A L");
    expect(outcome.register[0].mentions.map((m) => m.page)).toEqual([1, 2]);
    expect(outcome.changed).toBe(true);
  });

  it("dismisses known Candidates with a reason and reports unknown ids", () => {
    const outcome = applyRecord({
      register: [],
      dismissed: {},
      record: { dismiss: [{ ids: [0, 7], reason: "column header" }] },
      pages,
      candidates,
      rulebook: DEFAULT_RULEBOOK,
    });
    expect(outcome.dismissed).toEqual({ "0": "column header" });
    expect(outcome.report.join(" ")).toContain("unknown ids: 7");
  });

  it("refuses a merge into a Name that is not there", () => {
    const outcome = applyRecord({
      register: [name("Lumen Harbour Ltd")],
      dismissed: {},
      record: { merge: [{ into: "Nobody", from: ["Lumen Harbour Ltd"] }] },
      pages,
      candidates,
      rulebook: DEFAULT_RULEBOOK,
    });
    expect(outcome.register).toHaveLength(1);
    expect(outcome.report[0]).toContain("merge refused");
  });

  it("adds a Name with verified mentions and the finder it names", () => {
    const outcome = applyRecord({
      register: [],
      dismissed: {},
      record: {
        add: [
          {
            canonical: "Lumen Harbour Ltd",
            type: "organization",
            mentions: [
              { page: 2, quote: "Lumen Harbour Ltd" },
              { page: 2, quote: "Not On The Page" },
            ],
            confidence: 0.9,
            foundBy: "code",
          },
        ],
      },
      pages,
      candidates,
      rulebook: DEFAULT_RULEBOOK,
    });
    expect(outcome.register).toHaveLength(1);
    expect(outcome.register[0].foundBy).toContain("code");
    expect(outcome.register[0].mentions).toEqual([
      { page: 2, quote: "Lumen Harbour Ltd" },
    ]);
    expect(outcome.report.join(" ")).toContain("Dropped 1 mention");
  });
});

describe("foldInto", () => {
  it("never drops a form", () => {
    const merged = foldInto(
      { ...name("Ana Lucía Ferreira-Vos", 1), aliases: ["Ms Ferreira-Vos"] },
      { ...name("A. Ferreira"), aliases: ["ANA F"], foundBy: ["code"] },
    );
    expect(merged.aliases.sort()).toEqual([
      "A. Ferreira",
      "ANA F",
      "Ms Ferreira-Vos",
    ]);
    expect(merged.foundBy.sort()).toEqual(["code", "reader"]);
  });
});
