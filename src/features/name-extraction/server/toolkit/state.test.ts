import { describe, expect, it } from "vitest";
import type { ExtractedName } from "../../domain/contract";
import {
  candidateStatuses,
  cap,
  doneGate,
  gateRefusal,
  markRead,
  rangesText,
  type SweepCandidate,
  unreadRanges,
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
