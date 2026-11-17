import { describe, expect, it } from "vitest";
import { trimDetails } from "./domain/audit";
import { resolveRulebook } from "./domain/rules";
import { pipelineOf } from "./pipeline";
import type { EvaluationView, RunView } from "./view";

const rulebook = resolveRulebook({
  "field-confidence": {
    version: 2,
    enabled: true,
    params: { minConfidence: 0.95 },
  },
  "no-tampering": { version: 1, enabled: false, params: {} },
});

const evaluation: EvaluationView = {
  number: 2,
  createdAt: "2026-11-17T10:00:00Z",
  createdBy: "Jod",
  rules: rulebook.applied,
  findings: [
    {
      requirementId: "name-matches",
      title: "Name matches across all documents",
      outcome: "needs_review",
      reason: "",
      evidence: [],
    },
    {
      requirementId: "documents-legible",
      title: "Every document is legible",
      outcome: "pass",
      reason: "",
      evidence: [],
    },
  ],
  checks: [
    {
      documentKind: "identity_document",
      fieldName: "full_name",
      value: "A",
      spanRefs: ["s1"],
      outcome: "needs_review",
      expected: null,
      note: "low confidence",
    },
  ],
};

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
      pages: [],
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
        {
          name: "date_of_birth",
          value: "B",
          verified: false,
          confidence: 0.9,
          spanRefs: [],
        },
      ],
      checks: [],
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
  evaluations: [],
  reviews: [
    {
      requirementId: "name-matches",
      evaluation: 2,
      findingOutcome: "needs_review",
      outcome: "pass",
      note: "Known variant",
      reviewer: "Jod",
      at: "2026-11-17T11:00:00Z",
    },
  ],
};

describe("pipelineOf", () => {
  const pipeline = pipelineOf(view, evaluation, [
    "identity_document",
    "proof_of_address",
  ]);

  it("gives each Document a lane of four steps, only Read by the model", () => {
    expect(pipeline.lanes.map((lane) => lane.kind)).toEqual([
      "identity_document",
      "proof_of_address",
    ]);
    const [identity] = pipeline.lanes;
    expect(identity.nodes.map((node) => [node.stage, node.by])).toEqual([
      ["parse", "code"],
      ["read", "model"],
      ["verify", "code"],
      ["check", "code"],
    ]);
  });

  it("measures Verify against the Evaluation's confidence Rule", () => {
    const verify = pipeline.lanes[0].nodes[2];
    expect(verify.headline).toBe("1/2 found on the page");
    expect(verify.rows).toContainEqual({
      label: "At least 95% sure",
      value: "0 of 1",
    });
    expect(verify.rows).toContainEqual({
      label: "Not found on the page",
      value: "date_of_birth",
    });
  });

  it("marks a Document the run never saved as not run", () => {
    const missing = pipeline.lanes[1].nodes;
    expect(missing.every((node) => node.state === "skipped")).toBe(true);
  });

  it("joins at Evaluate, listing each Rule's Version and outcome", () => {
    const [evaluate, findings] = pipeline.join;
    expect(evaluate.headline).toBe("9 Requirements · 2 edited");
    expect(evaluate.rows).toContainEqual({
      label: "no-tampering v1",
      value: "Off",
    });
    expect(evaluate.rows).toContainEqual({
      label: "name-matches v0",
      value: "Needs review",
    });
    expect(findings.rows).toContainEqual({
      label: "Settled by a Reviewer",
      value: "1 of 1 flagged",
    });
  });

  it("marks the join failed for a failed run", () => {
    const failed = pipelineOf({ ...view, status: "failed" }, evaluation, [
      "proof_of_address",
    ]);
    expect(failed.join.every((node) => node.state === "error")).toBe(true);
    expect(failed.lanes[0].nodes[0].headline).toBe("not finished");
  });
});

describe("trimDetails", () => {
  it("cuts long text and deep nesting so an event never holds a document", () => {
    const trimmed = trimDetails({
      note: "x".repeat(400),
      deep: { a: { b: { c: { d: 1 } } } },
    }) as { note: string; deep: unknown };
    expect(trimmed.note).toHaveLength(301);
    expect(trimmed.deep).toEqual({ a: { b: "{…}" } });
  });
});
