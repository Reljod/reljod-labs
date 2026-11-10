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
    completedAt: null,
    prescreenDate: "2026-11-07",
    documents: [
      {
        kind: "identity_document",
        parser: "tesseract",
        pageCount: 1,
        pages: [{ page: 1, imageUrl: "" }],
        spans: [
          {
            ref: "s1",
            page: 1,
            text: "A",
            box: { x0: 0, y0: 0, x1: 1, y1: 1 },
            confidence: 0.8,
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
        judgments: {
          legible: true,
          tamperingSuspected: false,
          tamperingSpanRefs: [],
          signaturePresent: null,
          notes: "",
        },
        metrics: {
          model: "openai/model",
          provider: "openai",
          inputTokens: 1200,
          outputTokens: 300,
          reasoningTokens: null,
          cachedInputTokens: null,
          costUsd: 0.0042,
          parseMs: 800,
          readMs: 4200,
        },
        raw: null,
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

  it("replays what reading cost and how long each stage took", () => {
    const identity = fold(replayEvents(view)).documents.identity_document;
    expect(identity.usage?.costUsd).toBe(0.0042);
    expect(identity.parseMs).toBe(800);
    expect(identity.readMs).toBe(4200);
    expect(identity.firstOutputAt).toBe(5000);
  });

  it("interleaves Documents in the order their output first arrived", () => {
    const [identity] = view.documents;
    const slow = {
      ...identity,
      metrics: identity.metrics && { ...identity.metrics, readMs: 9000 },
    };
    const fast = {
      ...identity,
      kind: "proof_of_address" as const,
      metrics: identity.metrics && { ...identity.metrics, readMs: 1000 },
    };
    const fields = replayEvents({ ...view, documents: [slow, fast] }).filter(
      (event) => event.type === "field",
    );
    expect(fields.map((event) => event.kind)).toEqual([
      "proof_of_address",
      "identity_document",
    ]);
  });
});

describe("usage events", () => {
  it("keep a Document's usage and log its price and model", () => {
    const state = fold([
      {
        at: 0,
        type: "usage",
        kind: "certified_copy",
        usage: {
          model: "openai/model",
          provider: "azure",
          inputTokens: 2000,
          outputTokens: 120,
          reasoningTokens: 40,
          cachedInputTokens: 0,
          costUsd: 0.00311,
        },
      },
    ]);
    expect(state.documents.certified_copy.usage?.provider).toBe("azure");
    expect(state.log[0].text).toContain("$0.0031");
    expect(state.log[0].text).toContain("openai/model via azure");
  });

  it("record the first output time once, from the first reading", () => {
    const state = fold([
      {
        at: 10,
        type: "field",
        kind: "identity_document",
        reading: reading("full_name", "A"),
      },
      {
        at: 20,
        type: "field",
        kind: "identity_document",
        reading: reading("date_of_birth", "B"),
      },
    ]);
    expect(state.documents.identity_document.firstOutputAt).toBe(10);
  });
});
