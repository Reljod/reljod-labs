import { describe, expect, it } from "vitest";
import type { ScanEvent } from "./scan-events";
import { initialScanState, replayEvents, scanReducer } from "./scan-state";
import type { RunView } from "./view";

const fold = (events: ScanEvent[]) =>
  events.reduce(scanReducer, initialScanState());

const reading = (name: "full_name" | "date_of_birth", value: string) => ({
  name,
  value,
  spanRefs: ["s1"],
  confidence: 0.9,
});

describe("scanReducer", () => {
  it("keeps one reading per field, replacing a re-read", () => {
    const state = fold([
      {
        at: 0,
        type: "field",
        kind: "identity_document",
        reading: reading("full_name", "A"),
      },
      {
        at: 1,
        type: "field",
        kind: "identity_document",
        reading: reading("date_of_birth", "B"),
      },
      {
        at: 2,
        type: "field",
        kind: "identity_document",
        reading: reading("full_name", "C"),
      },
    ]);
    expect(
      state.documents.identity_document.readings.map((item) => item.value),
    ).toEqual(["B", "C"]);
    expect(state.received).toBe(3);
  });

  it("drops earlier readings when a read is retried", () => {
    const state = fold([
      {
        at: 0,
        type: "field",
        kind: "proof_of_address",
        reading: reading("full_name", "A"),
      },
      {
        at: 5,
        type: "stage",
        kind: "proof_of_address",
        stage: "read",
        state: "retry",
        attempt: 2,
      },
    ]);
    expect(state.documents.proof_of_address.readings).toEqual([]);
    expect(state.log.at(-1)).toMatchObject({ tone: "warn", at: 5 });
  });

  it("logs a failed run and records its end", () => {
    const state = fold([
      { at: 0, type: "end", status: "failed", error: "boom" },
    ]);
    expect(state.end).toEqual({ status: "failed", error: "boom" });
    expect(state.log[0]).toMatchObject({ tone: "bad" });
  });
});

describe("replayEvents", () => {
  const view: RunView = {
    id: "run",
    packSlug: "clean",
    status: "completed",
    error: null,
    model: "m",
    createdAt: "",
    prescreenDate: "2026-11-07",
    documents: [
      {
        kind: "identity_document",
        parser: "paddleocr",
        pageCount: 1,
        pages: [{ page: 1, imageUrl: "" }],
        spans: [
          {
            ref: "s1",
            page: 1,
            text: "A",
            box: { x0: 0, y0: 0, x1: 1, y1: 1 },
          },
        ],
        fields: [
          {
            name: "full_name",
            value: "A",
            verified: true,
            confidence: 0.9,
            spanRefs: ["s1"],
          },
        ],
        checks: [
          {
            documentKind: "identity_document",
            fieldName: "full_name",
            value: "A",
            spanRefs: ["s1"],
            outcome: "pass",
            expected: "A",
            note: "matches declaration",
          },
        ],
      },
    ],
    findings: [],
  };

  it("rebuilds a stored run into the state a live run ends in", () => {
    const state = fold(replayEvents(view));
    const identity = state.documents.identity_document;
    expect(identity.spans).toHaveLength(1);
    expect(identity.readings.map((item) => item.name)).toEqual(["full_name"]);
    expect(identity.checks?.[0].outcome).toBe("pass");
    expect(identity.stages).toEqual({
      parse: "done",
      read: "done",
      check: "done",
    });
    expect(state.findings).toEqual([]);
    expect(state.end).toEqual({ status: "completed", error: undefined });
  });
});
