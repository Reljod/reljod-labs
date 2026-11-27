import { describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { trimDetails } from "../../domain/audit";
import { LIMITS } from "../../domain/limits";
import { resolveRulebook } from "../../domain/rules";
import type { RunView } from "../../view";
import type {
  AuditLog,
  Caller,
  DocumentReader,
  PrescreenWorkflow,
  RuleRepository,
  RunRepository,
} from "../ports";
import { createPrescreenService } from "./prescreen";
import { createRulesService } from "./rules";
import { createRunsService } from "./runs";

const OWNER = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const visitor = (trusted = false) => ({ hash: "v", trusted });
const caller = (trusted = false): Caller => ({
  owner: OWNER,
  actor: { kind: "person", label: "Guest · Test" },
  visitor: visitor(trusted),
});

const unused = (name: string) => () => {
  throw new Error(`${name} should not be called`);
};

/** A finished stale-bill run whose proof of address failed, as Evaluation 1. */
function finishedRun(): RunView {
  const rulebook = resolveRulebook({});
  return {
    id: RUN_ID,
    packSlug: "stale-bill",
    status: "completed",
    error: null,
    model: "m",
    createdAt: "2026-11-27T10:00:00+00:00",
    completedAt: "2026-11-27T10:01:00+00:00",
    prescreenDate: "2026-11-07",
    documents: [],
    findings: [],
    evaluations: [
      {
        number: 1,
        createdAt: "2026-11-27T10:01:00+00:00",
        createdBy: null,
        rules: rulebook.applied,
        checks: [],
        findings: [
          {
            requirementId: "proof-of-address-recent",
            title: "Proof of address recent",
            outcome: "fail",
            reason: "Too old.",
            evidence: [],
          },
          {
            requirementId: "identity-document-present",
            title: "Identity document present",
            outcome: "pass",
            reason: "Present.",
            evidence: [],
          },
        ],
      },
    ],
    reviews: [],
  };
}

function setup(overrides: { runs?: Partial<RunRepository> } = {}) {
  const calls: string[] = [];
  const runs: RunRepository = {
    create: vi.fn(async () => {
      calls.push("create");
      return { runId: RUN_ID };
    }),
    latestCompletedId: vi.fn(async () => "latest-run"),
    setWorkflowRunId: vi.fn(async () => {
      calls.push("setWorkflowRunId");
    }),
    setStatus: unused("setStatus"),
    fail: vi.fn(async () => {
      calls.push("fail");
    }),
    workflowRunIdOf: vi.fn(async () => null),
    load: vi.fn(async () => null),
    list: vi.fn(async () => []),
    saveDocument: unused("saveDocument"),
    saveFindings: unused("saveFindings"),
    recordEvaluation: vi.fn(async () => {
      calls.push("recordEvaluation");
      return { number: 2 };
    }),
    recordReview: vi.fn(async () => {
      calls.push("recordReview");
      return null;
    }),
    ...overrides.runs,
  };
  const audit: AuditLog = {
    append: vi.fn(async (event) => {
      calls.push(`audit:${event.action}`);
    }),
    list: vi.fn(async () => ({ events: [], before: null })),
  };
  const workflow: PrescreenWorkflow = {
    start: vi.fn(async () => {
      calls.push("workflow.start");
      return "wrun_1";
    }),
    events: vi.fn(async function* () {}),
  };
  const ruleRows: RuleRepository = {
    versions: vi.fn(async () => []),
    saveVersion: vi.fn(async () => {
      calls.push("saveVersion");
      return { version: 1 };
    }),
  };
  const rules = createRulesService({ rules: ruleRows });
  const service = createRunsService({
    runs,
    audit,
    workflow,
    rules,
    model: "m",
  });
  return { service, rules, runs, audit, workflow, ruleRows, calls };
}

describe("starting a Pre-screen takes its caps before anything is paid for", () => {
  it("passes the hourly and daily caps to the run's insert, and none for the e2e suite", async () => {
    const { service, runs } = setup();
    await service.start(caller(), "clean");
    expect(runs.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        owner: OWNER,
        limits: {
          perVisitorPerHour: LIMITS.prescreensPerVisitorPerHour,
          perDay: LIMITS.prescreensPerDay,
        },
      }),
    );
    await service.start(caller(true), "clean");
    expect(runs.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ limits: null }),
    );
  });

  it("a refused run writes no Audit event and starts no workflow, and points at the latest stored run", async () => {
    const { service, calls, runs } = setup({
      runs: { create: async () => ({ refusal: "visitor" }) },
    });
    const refusal = await service.start(caller(), "clean").catch((e) => e);
    expect(refusal).toBeInstanceOf(LimitError);
    expect(refusal.extra).toEqual({ runId: "latest-run" });
    expect(runs.latestCompletedId).toHaveBeenCalledWith("clean", OWNER);
    expect(calls).toEqual([]);
  });

  it("refuses an unknown pack before writing anything", async () => {
    const { service, calls } = setup();
    await expect(service.start(caller(), "nope")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(calls).toEqual([]);
  });

  it("audits the start before the workflow runs, and fails the run when the workflow cannot start", async () => {
    const ok = setup();
    await ok.service.start(caller(), "clean");
    expect(ok.calls).toEqual([
      "create",
      "audit:run.started",
      "workflow.start",
      "setWorkflowRunId",
    ]);

    const broken = setup();
    vi.mocked(broken.workflow.start).mockRejectedValue(new Error("queue down"));
    await expect(broken.service.start(caller(), "clean")).rejects.toThrow(
      "queue down",
    );
    expect(broken.calls).toEqual(["create", "audit:run.started", "fail"]);
  });
});

describe("another Owner's run is not found", () => {
  it("for reading, streaming, re-evaluating and reviewing, and nothing is written", async () => {
    const { service, runs, workflow, calls } = setup();
    await expect(service.get(OWNER, RUN_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.events(OWNER, RUN_ID, 0)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.reevaluate(caller(), RUN_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      service.review(caller(), RUN_ID, {
        requirementId: "proof-of-address-recent",
        evaluation: 1,
        outcome: "pass",
        note: "Checked by hand",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Every read was scoped to the caller's Owner.
    for (const call of vi.mocked(runs.load).mock.calls) {
      expect(call).toEqual([RUN_ID, OWNER]);
    }
    expect(runs.workflowRunIdOf).toHaveBeenCalledWith(RUN_ID, OWNER);
    expect(workflow.events).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("re-evaluations and Reviewer decisions", () => {
  it("refuses a re-evaluation with the Rules the latest Evaluation applied", async () => {
    const { service, calls } = setup({
      runs: { load: async () => finishedRun() },
    });
    await expect(service.reevaluate(caller(), RUN_ID)).rejects.toThrow(
      "Your Rules are the ones Evaluation 1 applied. Edit a Rule first.",
    );
    expect(calls).toEqual([]);
  });

  it("re-evaluates with edited Rules and records the next Evaluation, without a model", async () => {
    const { service, ruleRows, calls } = setup({
      runs: { load: async () => finishedRun() },
    });
    vi.mocked(ruleRows.versions).mockResolvedValue([
      {
        ruleId: "proof-of-address-recent",
        version: 1,
        enabled: true,
        params: { maxAgeMonths: 6 },
        restoredFrom: null,
        savedBy: "Guest · Test",
        savedAt: "2026-11-27T10:02:00+00:00",
      },
    ]);
    const result = await service.reevaluate(caller(), RUN_ID);
    expect(result.number).toBe(2);
    expect(calls).toEqual(["recordEvaluation"]);
  });

  it("refuses a decision without a note, on a stale Evaluation or on a passing Finding, before writing it", async () => {
    const { service, calls } = setup({
      runs: { load: async () => finishedRun() },
    });
    const decide = (input: {
      requirementId?: string;
      evaluation?: number;
      note?: string;
    }) =>
      service.review(caller(), RUN_ID, {
        requirementId: input.requirementId ?? "proof-of-address-recent",
        evaluation: input.evaluation ?? 1,
        outcome: "pass",
        note: input.note ?? "Bill is a known variant.",
      });
    await expect(decide({ note: "  " })).rejects.toBeInstanceOf(InvalidError);
    await expect(decide({ evaluation: 2 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      decide({ requirementId: "identity-document-present" }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
    await decide({});
    expect(calls).toEqual(["recordReview"]);
  });
});

describe("Rules", () => {
  it("refuses an edit its Rule does not accept, with the Parameter's error, and saves nothing", async () => {
    const { rules, ruleRows, calls } = setup();
    const refusal = await rules
      .save(caller(), "proof-of-address-recent", {
        params: { maxAgeMonths: 13 },
      })
      .catch((e) => e);
    expect(refusal).toBeInstanceOf(InvalidError);
    expect(refusal.extra.errors).toEqual([
      expect.objectContaining({ param: "maxAgeMonths" }),
    ]);
    expect(ruleRows.versions).toHaveBeenCalledWith(
      OWNER,
      "proof-of-address-recent",
    );
    expect(calls).toEqual([]);
  });

  it("does not know a Rule or a Version that is not there", async () => {
    const { rules } = setup();
    await expect(
      rules.save(caller(), "no-such-rule", { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      rules.restore(caller(), "proof-of-address-recent", 7),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reading a Document stays traceable", () => {
  const span = (ref: string, text: string) => ({
    ref,
    page: 1,
    text,
    granularity: "line" as const,
    box: { x0: 0, y0: 0, x1: 1, y1: 1 },
    confidence: null,
  });
  const reader: DocumentReader = {
    model: "m",
    read: async () => ({
      readings: [
        {
          name: "statement_date",
          value: "02 Oct 2026",
          spanRefs: ["p1-s1"],
          confidence: 0.99,
        },
        {
          name: "full_name",
          value: "Amara L. Velasco",
          spanRefs: ["p1-s2"],
          confidence: 0.99,
        },
      ],
      judgments: {
        legible: true,
        tamperingSuspected: false,
        tamperingSpanRefs: [],
        signaturePresent: null,
        notes: "",
      },
      // Only OCR text may be corrected; a born-digital PDF's never is.
      corrections: [{ ref: "p1-s2", text: "Amara L. Velasco" }],
      usage: {
        model: "m",
        provider: null,
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: null,
        cachedInputTokens: null,
        costUsd: null,
      },
      raw: { corrections: [], fields: [], judgments: {} as never },
    }),
  };

  it("verifies every reading against its cited Spans, whatever the reader says", async () => {
    const service = createPrescreenService({
      runs: {} as RunRepository,
      audit: {} as AuditLog,
      packs: {
        download: async () => new Uint8Array(),
        signedUrl: unused("signedUrl"),
      },
      parser: { parse: unused("parse") },
      reader,
      logLost: () => {},
    });
    const spans = [
      span("p1-s1", "Statement date: 02 Oct 2026"),
      span("p1-s2", "Marisol Velasco"),
    ];
    const run = { runId: RUN_ID, packSlug: "clean", rules: null, owner: OWNER };
    const { extracted, corrections } = await service.read(
      run,
      "proof_of_address",
      spans,
      false,
    );
    expect(corrections).toEqual([]);
    expect(extracted.spans).toEqual(spans);
    expect(
      extracted.fields.map(({ name, verified }) => [name, verified]),
    ).toEqual([
      ["statement_date", true],
      ["full_name", false],
    ]);
  });
});

describe("an Audit event never holds a document", () => {
  it("cuts long text and deep nesting", () => {
    const trimmed = trimDetails({
      note: "x".repeat(400),
      deep: { a: { b: { c: { d: 1 } } } },
    }) as { note: string; deep: unknown };
    expect(trimmed.note).toHaveLength(301);
    expect(trimmed.deep).toEqual({ a: { b: "{…}" } });
  });
});
