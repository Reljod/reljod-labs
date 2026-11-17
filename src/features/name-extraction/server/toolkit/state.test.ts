import { describe, expect, it } from "vitest";
import type { ExtractedName } from "../../domain/contract";
import {
  boundTokens,
  candidateStatuses,
  cap,
  doneGate,
  gateRefusal,
  markRead,
  planReaderRanges,
  RUN_LIMITS,
  rangesText,
  readerModelRefusal,
  type SweepCandidate,
  unreadRanges,
  worstCaseCost,
} from "./state";

const candidate = (id: number, text: string, pages = [1]): SweepCandidate => ({
  id,
  text,
  typeGuess: "unknown",
  pages,
  count: pages.length,
  signals: ["capitalised"],
});

const name = (canonical: string, aliases: string[] = []): ExtractedName => ({
  canonical,
  type: "person",
  aliases,
  roles: ["other"],
  mentions: [{ page: 1, quote: canonical }],
  confidence: 0.9,
  foundBy: ["reader"],
});

describe("the Done gate", () => {
  const candidates = [
    candidate(0, "Ana Ferreira"),
    candidate(1, "Account Holder"),
    candidate(2, "Ferreira Avenue"),
  ];

  it("passes only with every page read and no open Candidate", () => {
    const state = {
      register: [name("Ana Ferreira")],
      dismissed: { "1": "column header", "2": "street" },
      pagesRead: [1, 2, 3],
    };
    expect(doneGate(3, candidates, state)).toEqual({
      pagesTotal: 3,
      pagesRead: 3,
      candidatesOpen: 0,
      passed: true,
    });
    expect(doneGate(4, candidates, state).passed).toBe(false);
    expect(
      doneGate(3, candidates, { ...state, dismissed: {} }).candidatesOpen,
    ).toBe(2);
  });

  it("counts a Candidate as recorded when a Name answers to it by alias", () => {
    const statuses = candidateStatuses([candidate(0, "FERREIRA A")], {
      register: [name("Ana Ferreira", ["FERREIRA A"])],
      dismissed: {},
    });
    expect(statuses[0].status).toBe("recorded");
  });

  it("ignores read pages outside the Document", () => {
    expect(
      doneGate(2, [], { register: [], dismissed: {}, pagesRead: [0, 1, 2, 9] })
        .pagesRead,
    ).toBe(2);
  });

  it("says what is missing when finish is refused", () => {
    const state = { register: [], dismissed: {}, pagesRead: [1, 2, 5] };
    const gate = doneGate(7, candidates, state);
    const text = gateRefusal(gate, candidates, state);
    expect(text).toContain("Unread pages: 3-4, 6-7");
    expect(text).toContain('#1 "Account Holder"');
    expect(text).toContain("open Candidates 3");
  });
});

describe("page bookkeeping", () => {
  it("keeps read pages sorted and unique", () => {
    expect(markRead([5, 1], [3, 1, 2])).toEqual([1, 2, 3, 5]);
  });

  it("writes unread pages as ranges", () => {
    expect(rangesText(unreadRanges(10, [1, 2, 5, 9]))).toBe("3-4, 6-8, 10");
    expect(unreadRanges(3, [1, 2, 3])).toEqual([]);
  });

  it("caps long tool output and says so", () => {
    expect(cap("abc", 10)).toBe("abc");
    expect(cap("x".repeat(20), 10)).toMatch(
      /^x{10}\n… \[10 more characters cut/,
    );
  });
});

describe("Reader spend", () => {
  it("bounds tokens at one per UTF-8 byte", () => {
    expect(boundTokens("")).toBe(0);
    expect(boundTokens("abcd")).toBe(4);
    expect(boundTokens("José")).toBe(5);
    expect(boundTokens("😀")).toBe(4);
  });

  it("prices the worst case: cache writes, and the tier the input could reach", () => {
    const haiku = "anthropic/claude-haiku-5.5";
    // Under the 100k tier: input at 1.25x for cache writes.
    expect(worstCaseCost(haiku, 100_000, 0)).toBeCloseTo(
      (100_000 * 0.1 * 1.25) / 1e6,
    );
    // Over it: the whole call at the tier's prices.
    expect(worstCaseCost(haiku, 100_001, 1_000)).toBeCloseTo(
      (100_001 * 0.5 * 1.25 + 1_000 * 2.5) / 1e6,
    );
    expect(worstCaseCost("nobody/model", 1, 1)).toBe(Number.POSITIVE_INFINITY);
  });

  it("lets a call switch only to a model no pricier than the Run's Reader model", () => {
    const reader = "anthropic/claude-haiku-5.5";
    expect(readerModelRefusal(reader, reader)).toBeNull();
    // Same prices: the second family for the recall audit.
    expect(readerModelRefusal("openai/gpt-6-luna", reader)).toBeNull();
    // Input pricier, output equal.
    expect(readerModelRefusal("zai/glm-5.3-flash", reader)).toContain(
      "costs more",
    );
    expect(readerModelRefusal("anthropic/claude-sonnet-5.5", reader)).toMatch(
      /^spawn_readers refused/,
    );
    // From a pricey Run Reader model, a cheaper one is fine.
    expect(
      readerModelRefusal(reader, "anthropic/claude-sonnet-5.5"),
    ).toBeNull();
    expect(readerModelRefusal("nobody/model", reader)).toContain(
      "unknown model",
    );
  });

  const page = (chars: number) => "a".repeat(chars);
  const pages = Array.from({ length: 300 }, () => page(4_000));
  const ranges = (count: number, size = 20) =>
    Array.from({ length: count }, (_, index) => ({
      from: index * size + 1,
      to: index * size + size,
    }));

  it("reserves each Reader's worst case: its prompt uncached at its output cap", () => {
    const plan = planReaderRanges({
      pages,
      ranges: [{ from: 1, to: 2, focus: "abcd" }],
      model: "anthropic/claude-haiku-5.5",
      readersLeft: 64,
      spentUsd: 0,
      overheadTokens: 1_000,
    });
    // 1,000 overhead + 4 focus + 2 pages of (4,000 + 48 frame) tokens.
    const expected = worstCaseCost(
      "anthropic/claude-haiku-5.5",
      1_000 + 4 + 2 * 4_048,
      RUN_LIMITS.readerOutputTokens,
    );
    expect(plan.ranges).toEqual([
      { from: 1, to: 2, focus: "abcd", estimateUsd: expected },
    ]);
    expect(plan.reservedUsd).toBe(expected);
    expect(plan.notes).toEqual([]);
  });

  it("accepts Readers only while spend plus reservations stays under the cap", () => {
    const model = "anthropic/claude-sonnet-5.5";
    const plan = planReaderRanges({
      pages,
      ranges: ranges(15),
      model,
      readersLeft: 64,
      spentUsd: 0.5,
      overheadTokens: 2_000,
    });
    const each = plan.ranges[0].estimateUsd;
    const fits = Math.floor((RUN_LIMITS.costUsd - 0.5) / each);
    expect(plan.ranges).toHaveLength(fits);
    expect(fits).toBeLessThan(15);
    expect(0.5 + plan.reservedUsd).toBeLessThanOrEqual(RUN_LIMITS.costUsd);
    expect(
      plan.notes.filter((note) => note.includes("spend cap")),
    ).toHaveLength(15 - fits);
    expect(plan.notes.at(-1)).toMatch(/^Spend: \$0\.500 spent/);
  });

  it("refuses every Reader once the Run has spent its cap", () => {
    const plan = planReaderRanges({
      pages,
      ranges: ranges(3),
      model: "anthropic/claude-haiku-5.5",
      readersLeft: 64,
      spentUsd: RUN_LIMITS.costUsd,
      overheadTokens: 0,
    });
    expect(plan.ranges).toEqual([]);
    expect(plan.reservedUsd).toBe(0);
  });

  it("bounds a full fan-out of the priciest model by the cap", () => {
    const plan = planReaderRanges({
      pages: Array.from({ length: 500 }, () => page(12_000)),
      ranges: ranges(RUN_LIMITS.readersPerCall, 15),
      model: "anthropic/claude-sonnet-5.5",
      readersLeft: RUN_LIMITS.readers,
      spentUsd: 0,
      overheadTokens: 3_000,
    });
    expect(plan.ranges.length).toBeLessThan(RUN_LIMITS.readersPerCall);
    expect(plan.reservedUsd).toBeLessThanOrEqual(RUN_LIMITS.costUsd);
  });

  it("checks pages, size and the Reader cap before the spend", () => {
    const plan = planReaderRanges({
      pages: [...pages.slice(0, 40), page(300_000)],
      ranges: [
        { from: 0, to: 3 },
        { from: 1, to: 40 },
        { from: 41, to: 41 },
        { from: 1, to: 5 },
        { from: 6, to: 10 },
      ],
      model: "anthropic/claude-haiku-5.5",
      readersLeft: 1,
      spentUsd: 0,
      overheadTokens: 0,
    });
    expect(plan.ranges.map((range) => range.from)).toEqual([1]);
    expect(plan.notes).toEqual([
      "Range 0-3 skipped: pages run 1-41.",
      `Range 1-40 skipped: over ${RUN_LIMITS.pagesPerReader} pages; split it.`,
      expect.stringContaining("Range 41-41 skipped: 300,000 bytes of text"),
      "Range 6-10 skipped: the Run's Reader cap is reached.",
    ]);
  });

  it("keeps dense tables and OCR noise within the cap and under Haiku's tier", () => {
    // 30 pages of digits and punctuation, 3,000 characters each: 90,000
    // characters, which tokenize far denser than prose.
    const dense = Array.from({ length: 64 * 30 }, (_, index) =>
      `${String(index).padStart(6, "0")}|DE89 3704 0044 0532 0130 00|`
        .repeat(60)
        .slice(0, 3_000),
    );
    const model = "anthropic/claude-haiku-5.5";
    const wanted = Array.from({ length: 64 }, (_, index) => ({
      from: index * 30 + 1,
      to: index * 30 + 30,
    }));
    const plan = planReaderRanges({
      pages: dense,
      ranges: wanted,
      model,
      readersLeft: 64,
      spentUsd: 0,
      overheadTokens: 3_000,
    });
    expect(plan.reservedUsd).toBeLessThanOrEqual(RUN_LIMITS.costUsd);
    const tierAbove = 100_000;
    for (const range of plan.ranges) {
      const chars = dense
        .slice(range.from - 1, range.to)
        .reduce((sum, text) => sum + text.length, 0);
      expect(chars + 3_000 + 30 * 16).toBeLessThanOrEqual(tierAbove);
    }
  });
});

describe("Reader spend on non-Latin text", () => {
  it("bounds tokens by UTF-8 bytes, so 3-byte characters cannot pass the cap", () => {
    expect(boundTokens("abc")).toBe(3);
    expect(boundTokens("名前")).toBe(6);
    // 30 pages of 3-byte characters: 30,000 characters, 90,000 bytes each 3k.
    const cjk = Array.from({ length: 64 * 30 }, () => "名".repeat(1_000));
    const plan = planReaderRanges({
      pages: cjk,
      ranges: Array.from({ length: 64 }, (_, index) => ({
        from: index * 30 + 1,
        to: index * 30 + 30,
      })),
      model: "anthropic/claude-haiku-5.5",
      readersLeft: 64,
      spentUsd: 0,
      overheadTokens: 3_000,
    });
    expect(plan.reservedUsd).toBeLessThanOrEqual(RUN_LIMITS.costUsd);
    // A range over the byte limit is refused, not under-reserved.
    const tooBig = planReaderRanges({
      pages: Array.from({ length: 30 }, () => "名".repeat(1_100)),
      ranges: [{ from: 1, to: 30 }],
      model: "anthropic/claude-haiku-5.5",
      readersLeft: 64,
      spentUsd: 0,
      overheadTokens: 0,
    });
    expect(tooBig.ranges).toEqual([]);
    expect(tooBig.notes[0]).toMatch(/bytes of text/);
  });
});
