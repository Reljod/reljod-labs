import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Owner } from "@/features/access/domain/owner";
import type { AuditActor } from "../domain/audit";
import type { ExtractedDocument, Finding } from "../domain/types";
import type { ReadUsage } from "../metrics";
import type { RawExtraction } from "./extract";

/**
 * The Document compliance server code against a real Postgres with the
 * demo's migrations applied. Skipped unless DEMO_TEST_DATABASE_URL is set
 * (`pnpm test:demo-db` boots a throwaway database). Other suites share that
 * database, so every row here belongs to random Owners and a random visitor
 * hash, and is deleted afterwards; nothing is truncated.
 */
const url = process.env.DEMO_TEST_DATABASE_URL;

/** Runs once right after the next `loadRun`, to change the database between a server function's read and its write. */
const hooks = vi.hoisted(() => ({
  afterLoad: null as null | (() => Promise<void>),
}));

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ packPageUrls: async () => new Map() }));
vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return {
    ...actual,
    loadRun: async (...args: Parameters<typeof actual.loadRun>) => {
      const view = await actual.loadRun(...args);
      const hook = hooks.afterLoad;
      hooks.afterLoad = null;
      if (hook) await hook();
      return view;
    },
  };
});

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d:\d\d$/;

const OWNER = `host:${crypto.randomUUID()}` as Owner;
const OTHER = `host:${crypto.randomUUID()}` as Owner;
const BUSY = `host:${crypto.randomUUID()}` as Owner;
const VISITOR = `test-${crypto.randomUUID()}`;
const ACTOR: AuditActor = { kind: "person", label: "Test Reviewer" };
const SECOND_ACTOR: AuditActor = { kind: "person", label: "Second Reviewer" };

const usage: ReadUsage = {
  model: "openai/test-model",
  provider: "openai",
  inputTokens: 1200,
  outputTokens: 300,
  reasoningTokens: 50,
  cachedInputTokens: null,
  costUsd: 0.0125,
};

const identity: ExtractedDocument = {
  kind: "identity_document",
  spans: [
    {
      ref: "p1-s1",
      page: 1,
      text: "AMARA LUCIA",
      granularity: "line",
      box: { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.25 },
      confidence: 0.75,
    },
    {
      ref: "p1-s2",
      page: 1,
      text: "VELASCO",
      granularity: "line",
      box: { x0: 0.42, y0: 0.2, x1: 0.6, y1: 0.25 },
      confidence: 0.5,
    },
    {
      ref: "p1-s3",
      page: 1,
      text: "14 MAR 1991",
      granularity: "word",
      box: { x0: 0.1, y0: 0.3, x1: 0.3, y1: 0.35 },
      confidence: null,
    },
  ],
  fields: [
    {
      name: "full_name",
      value: "Amara Lucia Velasco",
      spanRefs: ["p1-s2", "p1-s1"],
      confidence: 0.75,
      verified: true,
    },
    {
      name: "date_of_birth",
      value: "1991-03-14",
      spanRefs: ["p1-s3"],
      confidence: 0.5,
      verified: false,
    },
  ],
  judgments: {
    legible: true,
    tamperingSuspected: true,
    tamperingSpanRefs: ["p1-s3"],
    signaturePresent: null,
    notes: "Date looks retouched",
  },
};

const raw: RawExtraction = {
  corrections: [],
  fields: identity.fields.map(({ name, value, spanRefs, confidence }) => ({
    name,
    value,
    spanRefs,
    confidence,
  })),
  judgments: identity.judgments,
};

const findings: Finding[] = [
  {
    requirementId: "no-tampering",
    outcome: "needs_review",
    reason: "The model suspects tampering.",
    evidence: [
      {
        documentKind: "identity_document",
        fieldName: null,
        spanRefs: ["p1-s3"],
      },
    ],
  },
  {
    requirementId: "identity-document-present",
    outcome: "pass",
    reason: "An identity document is present.",
    evidence: [
      { documentKind: "identity_document", fieldName: null, spanRefs: [] },
    ],
  },
  {
    requirementId: "name-matches",
    outcome: "fail",
    reason: "The name differs.",
    evidence: [
      {
        documentKind: "identity_document",
        fieldName: "full_name",
        spanRefs: ["p1-s1", "p1-s2"],
      },
      // A Document the run never saved is dropped, not written.
      { documentKind: "certified_copy", fieldName: null, spanRefs: ["x"] },
    ],
  },
];

describe.skipIf(!url)("Document compliance on Postgres", () => {
  let mod: {
    repository: typeof import("./repository");
    audit: typeof import("./audit");
    rules: typeof import("./rules");
    evaluations: typeof import("./evaluations");
    db: typeof import("./db");
    domainRules: typeof import("../domain/rules");
    packs: typeof import("../packs");
  };
  let runId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    mod = {
      repository: await import("./repository"),
      audit: await import("./audit"),
      rules: await import("./rules"),
      evaluations: await import("./evaluations"),
      db: await import("./db"),
      domainRules: await import("../domain/rules"),
      packs: await import("../packs"),
    };
  });

  afterAll(async () => {
    if (!mod) return;
    const sql = mod.db.sql();
    await sql`delete from document_compliance.prescreen_runs where owner = any(${[OWNER, OTHER, BUSY]})`;
    await sql`delete from document_compliance.rule_versions where owner = any(${[OWNER, OTHER, BUSY]})`;
    await sql`delete from document_compliance.audit_trails where owner = any(${[OWNER, OTHER, BUSY]})`;
    await sql.end();
  });

  const tryRun = (
    limits: { perVisitorPerHour: number; perDay: number } | null,
    visitorHash = VISITOR,
    owner: Owner = OWNER,
  ) => {
    const pack = mod.packs.findPack("clean");
    if (!pack) throw new Error("clean pack missing");
    return mod.repository.createRun({
      packSlug: pack.slug,
      rulebook: mod.domainRules.resolveRulebook({}),
      declaration: pack.clientDeclaration,
      visitorHash,
      owner,
      model: "openai/test-model",
      limits,
    });
  };
  const startRun = async (owner: Owner = OWNER) => {
    const result = await tryRun(null, VISITOR, owner);
    if (!("runId" in result)) throw new Error(`refused: ${result.refusal}`);
    return result.runId;
  };

  it("creates a run and keeps its status and workflow id to its Owner", async () => {
    const { repository } = mod;
    runId = await startRun();
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    await repository.setRunStatus(runId, "parsing");
    await repository.setWorkflowRunId(runId, "wrun_123");
    expect(await repository.workflowRunIdOf(runId, OWNER)).toBe("wrun_123");
    expect(await repository.workflowRunIdOf(runId, OTHER)).toBeNull();

    const view = await repository.loadRun(runId, OWNER);
    expect(view?.status).toBe("parsing");
    expect(view?.completedAt).toBeNull();
    expect(view?.createdAt).toMatch(ISO);
    expect(view?.documents).toEqual([]);
    expect(await repository.loadRun(runId, OTHER)).toBeNull();
  });

  it("saves Documents with their Spans, Fields and links, and Findings with their Evidence", async () => {
    const { repository } = mod;
    const savedIdentity = await repository.saveDocument(
      runId,
      {
        storagePath: "presets/clean/identity-document.jpg",
        mediaType: "image/jpeg",
        sourceFormat: "image",
        parser: "paddleocr",
        pageCount: 1,
        parseMs: 120.4,
        readMs: 2400.6,
        usage,
        raw,
      },
      identity,
    );
    expect(typeof savedIdentity.documentId).toBe("number");
    expect([...savedIdentity.spanIds.keys()].sort()).toEqual([
      "p1-s1",
      "p1-s2",
      "p1-s3",
    ]);
    expect([...savedIdentity.fieldIds.keys()].sort()).toEqual([
      "date_of_birth",
      "full_name",
    ]);
    // A Document with nothing on it still saves.
    const savedAddress = await repository.saveDocument(
      runId,
      {
        storagePath: "presets/clean/proof-of-address.pdf",
        mediaType: "application/pdf",
        sourceFormat: "pdf_digital",
        parser: "opendataloader_pdf",
        pageCount: 1,
        parseMs: 10,
        readMs: 20,
        usage: {
          ...usage,
          costUsd: 0.0025,
          inputTokens: 100,
          outputTokens: 10,
        },
        raw: { ...raw, fields: [] },
      },
      { ...identity, kind: "proof_of_address", spans: [], fields: [] },
    );
    expect(savedAddress.spanIds.size).toBe(0);

    await repository.saveFindings(
      runId,
      findings,
      new Map([
        ["identity_document", savedIdentity],
        ["proof_of_address", savedAddress],
      ]),
    );
  });

  it("loads the run back whole, in the shape the Reviewer view reads", async () => {
    const view = await mod.repository.loadRun(runId, OWNER);
    if (!view) throw new Error("run not found");
    expect(view.status).toBe("completed");
    expect(view.completedAt).toMatch(ISO);
    expect(view.packSlug).toBe("clean");
    expect(view.prescreenDate).toBe("2026-11-07");
    expect(view.documents.map((document) => document.kind)).toEqual([
      "identity_document",
      "proof_of_address",
    ]);

    const [document] = view.documents;
    expect(document?.parser).toBe("paddleocr");
    expect(document?.pages).toEqual([{ page: 1, imageUrl: "" }]);
    expect(document?.spans).toEqual([
      {
        ref: "p1-s1",
        page: 1,
        text: "AMARA LUCIA",
        box: { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.25 },
        confidence: 0.75,
      },
      {
        ref: "p1-s2",
        page: 1,
        text: "VELASCO",
        box: { x0: 0.42, y0: 0.2, x1: 0.6, y1: 0.25 },
        confidence: 0.5,
      },
      {
        ref: "p1-s3",
        page: 1,
        text: "14 MAR 1991",
        box: { x0: 0.1, y0: 0.3, x1: 0.3, y1: 0.35 },
        confidence: null,
      },
    ]);
    expect(document?.fields).toEqual([
      {
        name: "full_name",
        value: "Amara Lucia Velasco",
        verified: true,
        confidence: 0.75,
        spanRefs: ["p1-s1", "p1-s2"],
      },
      {
        name: "date_of_birth",
        value: "1991-03-14",
        verified: false,
        confidence: 0.5,
        spanRefs: ["p1-s3"],
      },
    ]);
    expect(document?.judgments).toEqual(identity.judgments);
    expect(document?.raw).toEqual(raw);
    expect(document?.metrics).toEqual({
      model: "openai/test-model",
      provider: "openai",
      inputTokens: 1200,
      outputTokens: 300,
      reasoningTokens: 50,
      cachedInputTokens: null,
      costUsd: 0.0125,
      parseMs: 120,
      readMs: 2401,
    });

    // Findings come in the Rulebook's order, whatever order they were saved in.
    const order = mod.domainRules
      .resolveRulebook({})
      .requirements.map((requirement) => requirement.id as string);
    const ids = view.findings.map((finding) => finding.requirementId as string);
    expect(ids).toEqual(
      [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    );
    expect(ids.sort()).toEqual([
      "identity-document-present",
      "name-matches",
      "no-tampering",
    ]);
    const byId = new Map(
      view.findings.map((item) => [item.requirementId, item]),
    );
    expect(byId.get("name-matches")).toMatchObject({
      outcome: "fail",
      reason: "The name differs.",
      evidence: [
        {
          documentKind: "identity_document",
          fieldName: "full_name",
          spanRefs: ["p1-s1", "p1-s2"],
        },
      ],
    });
    expect(byId.get("no-tampering")?.evidence).toEqual([
      {
        documentKind: "identity_document",
        fieldName: null,
        spanRefs: ["p1-s3"],
      },
    ]);
    expect(byId.get("identity-document-present")?.evidence).toEqual([
      { documentKind: "identity_document", fieldName: null, spanRefs: [] },
    ]);

    expect(view.evaluations).toHaveLength(1);
    expect(view.evaluations[0]).toMatchObject({
      number: 1,
      createdBy: null,
      createdAt: view.completedAt,
    });
    expect(view.reviews).toEqual([]);
  });

  it("lists, counts and finds only the Owner's runs", async () => {
    const { repository } = mod;
    const runs = await repository.listOwnerRuns(OWNER);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: runId,
      packSlug: "clean",
      status: "completed",
      model: "openai/test-model",
      tokens: 1200 + 300 + 100 + 10,
      counts: { pass: 1, fail: 1, needs_review: 1 },
    });
    expect(runs[0]?.costUsd).toBeCloseTo(0.015, 10);
    expect(runs[0]?.createdAt).toMatch(ISO);
    expect(await repository.listOwnerRuns(OTHER)).toEqual([]);

    expect(await repository.latestCompletedRunId("clean", OWNER)).toBe(runId);
    expect(await repository.latestCompletedRunId("clean", OTHER)).toBeNull();
    expect(
      await repository.latestCompletedRunId("stale-bill", OWNER),
    ).toBeNull();
  });

  it("lists runs newest first, up to the limit", async () => {
    const { repository } = mod;
    const newer = await startRun();
    const listed = await repository.listOwnerRuns(OWNER, 1);
    expect(listed.map((run) => run.id)).toEqual([newer]);
    expect(listed[0]).toMatchObject({
      status: "queued",
      // A run with no Documents yet has no cost to show.
      costUsd: null,
      tokens: 0,
      counts: { pass: 0, fail: 0, needs_review: 0 },
    });
    expect(
      (await repository.listOwnerRuns(OWNER)).map((run) => run.id),
    ).toEqual([newer, runId]);

    await repository.failRun(newer, "x".repeat(1500));
    const failed = await repository.loadRun(newer, OWNER);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toHaveLength(1000);
    // A failed run is never where a limited visitor lands.
    expect(await repository.latestCompletedRunId("clean", OWNER)).toBe(runId);
  });

  it("appends Audit events and pages through them newest first, per Owner", async () => {
    const { audit } = mod;
    await audit.audit({
      owner: OWNER,
      runId,
      actor: { kind: "model", label: "Model" },
      action: "document.read",
      summary: "Read the identity document",
      details: { kind: "identity_document" },
      usage: {
        model: "openai/test-model",
        inputTokens: 1200,
        outputTokens: 300,
        costUsd: 0.0125,
      },
    });
    await audit.audit({
      owner: OWNER,
      runId: null,
      actor: ACTOR,
      action: "run.started",
      summary: "Started a Pre-screen",
    });
    await audit.auditBestEffort({
      owner: OWNER,
      runId,
      actor: { kind: "system", label: "System" },
      action: "run.finished",
      summary: "Finished",
    });

    const page = await audit.listAuditEvents(OWNER);
    expect(page.events.map((event) => event.action)).toEqual([
      "run.finished",
      "run.started",
      "document.read",
    ]);
    expect(page.before).toBeNull();
    const ids = page.events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const read = page.events[2];
    expect(read).toMatchObject({
      actor: { kind: "model", label: "Model" },
      runId,
      summary: "Read the identity document",
      details: { kind: "identity_document" },
      usage: {
        model: "openai/test-model",
        inputTokens: 1200,
        outputTokens: 300,
        costUsd: 0.0125,
      },
    });
    expect(typeof read?.id).toBe("number");
    expect(read?.at).toMatch(ISO);
    expect(page.events[1]).toMatchObject({
      runId: null,
      usage: null,
      details: {},
    });

    const forRun = await audit.listAuditEvents(OWNER, { runId });
    expect(forRun.events.map((event) => event.action)).toEqual([
      "run.finished",
      "document.read",
    ]);
    const started = await audit.listAuditEvents(OWNER, {
      action: "run.started",
    });
    expect(started.events).toHaveLength(1);

    const first = await audit.listAuditEvents(OWNER, { limit: 2 });
    expect(first.events.map((event) => event.id)).toEqual(ids.slice(0, 2));
    expect(first.before).toBe(ids[1]);
    const second = await audit.listAuditEvents(OWNER, {
      limit: 2,
      before: first.before,
    });
    expect(second.events.map((event) => event.id)).toEqual(ids.slice(2));
    expect(second.before).toBeNull();

    expect((await audit.listAuditEvents(OTHER)).events).toEqual([]);
    expect((await audit.listAuditEvents(OTHER, { runId })).events).toEqual([]);
  });

  it("refuses an Audit event the trail's constraints reject, with its reason", async () => {
    await expect(
      mod.audit.audit({
        owner: OWNER,
        runId: null,
        actor: ACTOR,
        action: "not.an.action" as never,
        summary: "x",
      }),
    ).rejects.toThrow(/^Could not write the Audit event: /);
  });

  it("saves, lists and restores Rule Versions per Owner", async () => {
    const { rules } = mod;
    const before = await rules.listRules(OWNER);
    expect(
      before.every((rule) => !rule.edited && rule.versionCount === 0),
    ).toBe(true);

    const saved = await rules.saveRule(OWNER, ACTOR, "field-confidence", {
      params: { minConfidence: 0.7 },
    });
    expect(saved).toEqual({ ok: true, version: 1 });
    expect(
      await rules.saveRule(OWNER, ACTOR, "field-confidence", {
        params: { minConfidence: 0.7 },
      }),
    ).toEqual({ ok: false, message: "Nothing changed." });
    expect(
      await rules.saveRule(OWNER, ACTOR, "field-confidence", {
        params: { minConfidence: 5 },
      }),
    ).toMatchObject({ ok: false });

    const listed = await rules.listRules(OWNER);
    const confidence = listed.find((rule) => rule.id === "field-confidence");
    expect(confidence).toMatchObject({
      edited: true,
      savedBy: "Test Reviewer",
      versionCount: 1,
      state: { version: 1, enabled: true, params: { minConfidence: 0.7 } },
    });
    expect(confidence?.savedAt).toMatch(ISO);
    expect(await rules.ownerRuleStates(OWNER)).toEqual({
      "field-confidence": {
        version: 1,
        enabled: true,
        params: { minConfidence: 0.7 },
      },
    });
    expect(await rules.ownerRuleStates(OTHER)).toEqual({});

    const restored = await rules.restoreRule(
      OWNER,
      SECOND_ACTOR,
      "field-confidence",
      0,
    );
    expect(restored).toEqual({ ok: true, version: 2 });
    expect(
      await rules.restoreRule(OWNER, ACTOR, "field-confidence", 9),
    ).toEqual({
      ok: false,
      message: "No such Version.",
    });
    expect(
      await rules.restoreRule(OWNER, ACTOR, "field-confidence", 2),
    ).toEqual({
      ok: false,
      message: "That Version is already in force.",
    });

    const versions = await rules.listRuleVersions(OWNER, "field-confidence");
    expect(
      versions.map((item) => [item.version, item.restoredFrom, item.savedBy]),
    ).toEqual([
      [2, 0, "Second Reviewer"],
      [1, null, "Test Reviewer"],
      [0, null, "Default"],
    ]);
    expect(versions[0]?.params).toEqual({ minConfidence: 0.6 });
    expect(versions[0]?.savedAt).toMatch(ISO);
    expect(versions[2]?.savedAt).toBeNull();
    expect(
      await rules.listRuleVersions(OTHER, "field-confidence"),
    ).toHaveLength(1);

    const events = await mod.audit.listAuditEvents(OWNER, {
      action: "rule.restored",
    });
    expect(events.events[0]?.details).toMatchObject({
      ruleId: "field-confidence",
      version: 2,
      from: { version: 1, enabled: true, params: { minConfidence: 0.7 } },
      to: { enabled: true, params: { minConfidence: 0.6 } },
    });
  });

  it("refuses a Rule save past the hourly cap", async () => {
    const sql = mod.db.sql();
    const { LIMITS } = await import("../domain/review");
    for (let n = 0; n < LIMITS.ruleSavesPerHour; n += 1) {
      await sql`
        insert into document_compliance.rule_versions (owner, rule_id, version, enabled, saved_by)
        values (${BUSY}, ${`filler-${n}`}, 1, true, 'Filler')`;
    }
    expect(
      await mod.rules.saveRule(BUSY, ACTOR, "field-confidence", {
        params: { minConfidence: 0.7 },
      }),
    ).toEqual({
      ok: false,
      message: `You can save up to ${LIMITS.ruleSavesPerHour} Rule changes an hour. Try again later.`,
    });
  });

  it("re-evaluates a run only when the Rules changed, and keeps each Evaluation", async () => {
    const { evaluations, repository } = mod;
    expect(await evaluations.reevaluateRun(OTHER, ACTOR, runId)).toEqual({
      ok: false,
      message: "No such run.",
    });
    // The restore saved the Default again as Version 2, so the Rules differ
    // from the run's own (Version 0) and the run can be re-evaluated.
    const result = await evaluations.reevaluateRun(OWNER, ACTOR, runId);
    expect(result).toMatchObject({ ok: true, number: 2 });
    expect(await evaluations.reevaluateRun(OWNER, ACTOR, runId)).toEqual({
      ok: false,
      message:
        "Your Rules are the ones Evaluation 2 applied. Edit a Rule first.",
    });

    const view = await repository.loadRun(runId, OWNER);
    expect(view?.evaluations.map((item) => item.number)).toEqual([1, 2]);
    const second = view?.evaluations[1];
    expect(second?.createdBy).toBe("Test Reviewer");
    expect(second?.createdAt).toMatch(ISO);
    expect(
      second?.rules.find((rule) => rule.ruleId === "field-confidence"),
    ).toMatchObject({ version: 2, params: { minConfidence: 0.6 } });
    expect(second?.findings.length).toBeGreaterThan(0);

    const events = await mod.audit.listAuditEvents(OWNER, {
      runId,
      action: "run.reevaluated",
    });
    expect(events.events[0]?.details).toMatchObject({
      pack: "clean",
      against: 1,
      evaluation: 2,
    });
  });

  it("records a Reviewer decision on the latest Evaluation", async () => {
    const { evaluations, repository } = mod;
    const view = await repository.loadRun(runId, OWNER);
    const flagged = view?.evaluations[1]?.findings.find(
      (finding) => finding.outcome !== "pass",
    );
    if (!flagged) throw new Error("expected a flagged Finding");

    expect(
      await evaluations.reviewFinding(
        OWNER,
        ACTOR,
        runId,
        flagged.requirementId,
        1,
        {
          outcome: "pass",
          note: "Checked by hand",
        },
      ),
    ).toEqual({
      ok: false,
      message:
        "The run was just re-evaluated. Look at the new Evaluation and review again.",
    });
    expect(
      await evaluations.reviewFinding(
        OWNER,
        ACTOR,
        runId,
        "not-a-requirement",
        2,
        {
          outcome: "pass",
          note: "Checked by hand",
        },
      ),
    ).toEqual({ ok: false, message: "No such Requirement." });

    expect(
      await evaluations.reviewFinding(
        OWNER,
        ACTOR,
        runId,
        flagged.requirementId,
        2,
        {
          outcome: "pass",
          note: "Checked by hand",
        },
      ),
    ).toEqual({ ok: true });
    const after = await repository.loadRun(runId, OWNER);
    expect(after?.reviews).toHaveLength(1);
    expect(after?.reviews[0]).toMatchObject({
      requirementId: flagged.requirementId,
      evaluation: 2,
      findingOutcome: flagged.outcome,
      outcome: "pass",
      note: "Checked by hand",
      reviewer: "Test Reviewer",
    });
    expect(after?.reviews[0]?.at).toMatch(ISO);
  });

  describe("the database's own refusals, when the run changes under a server function", () => {
    const flaggedId = async () => {
      const view = await mod.repository.loadRun(runId, OWNER);
      const latest = view?.evaluations.at(-1);
      const flagged = latest?.findings.find(
        (finding) => finding.outcome !== "pass",
      );
      if (!latest || !flagged) throw new Error("expected a flagged Finding");
      return { number: latest.number, requirementId: flagged.requirementId };
    };
    const setStatus = (status: string) =>
      mod.db.sql()`update document_compliance.prescreen_runs set status = ${status} where id = ${runId}`;
    const recordEvaluation = () =>
      mod.db.sql()`
        select document_compliance.record_evaluation(
          p_owner => ${OWNER}, p_run_id => ${runId}::uuid,
          p_rules_applied => '[]'::jsonb, p_findings => '[]'::jsonb,
          p_created_by => 'Filler', p_summary => 'Filler',
          p_details => '{}'::jsonb, p_max => 1000
        )`;

    it("stale_evaluation: a re-evaluation lands between the review's read and write", async () => {
      const { number, requirementId } = await flaggedId();
      hooks.afterLoad = async () => {
        await recordEvaluation();
      };
      expect(
        await mod.evaluations.reviewFinding(
          OWNER,
          ACTOR,
          runId,
          requirementId,
          number,
          {
            outcome: "fail",
            note: "Too late",
          },
        ),
      ).toEqual({
        ok: false,
        message:
          "The run was just re-evaluated. Look at the new Evaluation and review again.",
      });
    });

    it("run_not_found: the run stops being a finished run of the Owner's", async () => {
      // The filler Evaluation applied no Rules, so the Owner's Rules differ from it.
      hooks.afterLoad = () => setStatus("failed").then(() => undefined);
      expect(await mod.evaluations.reevaluateRun(OWNER, ACTOR, runId)).toEqual({
        ok: false,
        message: "No such run.",
      });
      await setStatus("completed");
      const view = await mod.repository.loadRun(runId, OWNER);
      expect(view?.evaluations.map((item) => item.number)).toEqual([1, 2, 3]);
    });

    it("limit_reached: Evaluations fill up between the read and the write", async () => {
      const { LIMITS } = await import("../domain/review");
      hooks.afterLoad = async () => {
        let count = 0;
        do {
          const [row] = await mod.db.sql()<{ count: number }[]>`
            select count(*)::int as count from document_compliance.evaluations where run_id = ${runId}`;
          count = row?.count ?? 0;
          if (count < LIMITS.reevaluationsPerRun) await recordEvaluation();
        } while (count < LIMITS.reevaluationsPerRun);
      };
      expect(await mod.evaluations.reevaluateRun(OWNER, ACTOR, runId)).toEqual({
        ok: false,
        message: `A run can be re-evaluated up to ${LIMITS.reevaluationsPerRun} times.`,
      });
      // And from then on the app refuses before it asks the database.
      expect(await mod.evaluations.reevaluateRun(OWNER, ACTOR, runId)).toEqual({
        ok: false,
        message: `A run can be re-evaluated up to ${LIMITS.reevaluationsPerRun} times.`,
      });
    });
  });

  describe("Reviewer refusals from the database", () => {
    let reviewRun: string;
    let requirementId: string;

    beforeAll(async () => {
      // A fresh finished run of its own, whose no-tampering Finding needs review.
      reviewRun = await startRun();
      const saved = await mod.repository.saveDocument(
        reviewRun,
        {
          storagePath: "presets/clean/identity-document.jpg",
          mediaType: "image/jpeg",
          sourceFormat: "image",
          parser: "paddleocr",
          pageCount: 1,
          parseMs: 1,
          readMs: 1,
          usage,
          raw,
        },
        identity,
      );
      await mod.repository.saveFindings(
        reviewRun,
        findings,
        new Map([["identity_document", saved]]),
      );
      requirementId = "no-tampering";
    });

    const review = () =>
      mod.evaluations.reviewFinding(OWNER, ACTOR, reviewRun, requirementId, 1, {
        outcome: "fail",
        note: "Tampered",
      });

    it("run_not_found: the run is no longer finished when the decision is written", async () => {
      hooks.afterLoad = async () => {
        await mod.db.sql()`update document_compliance.prescreen_runs set status = 'failed' where id = ${reviewRun}`;
      };
      expect(await review()).toEqual({ ok: false, message: "No such run." });
      await mod.db.sql()`update document_compliance.prescreen_runs set status = 'completed' where id = ${reviewRun}`;
      expect(
        await mod.evaluations.reviewFinding(
          OTHER,
          ACTOR,
          reviewRun,
          requirementId,
          1,
          {
            outcome: "fail",
            note: "Tampered",
          },
        ),
      ).toEqual({ ok: false, message: "No such run." });
    });

    it("limit_reached: decisions fill up between the read and the write", async () => {
      const { LIMITS } = await import("../domain/review");
      hooks.afterLoad = async () => {
        const sql = mod.db.sql();
        const rows = Array.from({ length: LIMITS.reviewsPerRun }, () => ({
          run_id: reviewRun,
          evaluation: 1,
          requirement_id: requirementId,
          finding_outcome: "needs_review",
          outcome: "pass",
          note: "Filler",
          reviewer: "Filler",
        }));
        await sql`insert into document_compliance.finding_reviews ${sql(rows)}`;
      };
      expect(await review()).toEqual({
        ok: false,
        message: `A run takes up to ${LIMITS.reviewsPerRun} Reviewer decisions.`,
      });
      const view = await mod.repository.loadRun(reviewRun, OWNER);
      expect(view?.reviews).toHaveLength(LIMITS.reviewsPerRun);
    });
  });

  describe("create_prescreen_run", () => {
    const sql = () => mod.db.sql();

    it("stores the declaration and the applied Rules as jsonb, not as strings", async () => {
      const [row] = await sql()<
        {
          declaration: string;
          rules: string;
          full_name: string;
          status: string;
          owner: string;
        }[]
      >`
        select jsonb_typeof(client_declaration) as declaration,
          jsonb_typeof(rules_applied) as rules,
          client_declaration->>'fullName' as full_name, status, owner
        from document_compliance.prescreen_runs where id = ${runId}`;
      expect(row).toEqual({
        declaration: "object",
        rules: "array",
        full_name: "Amara Lucia Velasco",
        status: "completed",
        owner: OWNER,
      });
      const [applied] = await sql()<{ n: number; first: string }[]>`
        select jsonb_array_length(rules_applied) as n,
          jsonb_typeof(rules_applied->0) as first
        from document_compliance.prescreen_runs where id = ${runId}`;
      expect(applied?.n).toBe(
        mod.domainRules.resolveRulebook({}).applied.length,
      );
      expect(applied?.first).toBe("object");
    });

    it("always creates with no limits", async () => {
      const visitor = `test-${crypto.randomUUID()}`;
      for (let n = 0; n < 3; n += 1) {
        expect(await tryRun(null, visitor)).toEqual({
          runId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        });
      }
    });

    it("refuses a visitor's run past the hourly limit", async () => {
      const visitor = `test-${crypto.randomUUID()}`;
      const limits = { perVisitorPerHour: 2, perDay: 1_000_000 };
      expect(await tryRun(limits, visitor)).toHaveProperty("runId");
      expect(await tryRun(limits, visitor)).toHaveProperty("runId");
      expect(await tryRun(limits, visitor)).toEqual({ refusal: "visitor" });
      // Another visitor still has room.
      expect(
        await tryRun(limits, `test-${crypto.randomUUID()}`),
      ).toHaveProperty("runId");
      const [row] = await sql()<{ count: number }[]>`
        select count(*)::int as count from document_compliance.prescreen_runs
        where visitor_hash = ${visitor}`;
      expect(row?.count).toBe(2);
    });

    it("refuses any run once the day's limit is reached", async () => {
      // Other suites share this database, so the cap is whatever the day holds
      // now; runs they add before the call only push the count further past it.
      const [today] = await sql()<{ count: number }[]>`
        select count(*)::int as count from document_compliance.prescreen_runs
        where created_at > now() - interval '1 day'`;
      const visitor = `test-${crypto.randomUUID()}`;
      expect(
        await tryRun(
          { perVisitorPerHour: 1_000, perDay: today?.count ?? 0 },
          visitor,
        ),
      ).toEqual({ refusal: "day" });
      expect(
        await tryRun(
          { perVisitorPerHour: 1_000, perDay: (today?.count ?? 0) + 1_000 },
          visitor,
        ),
      ).toHaveProperty("runId");
    });
  });

  it("deleting a run takes everything under it", async () => {
    await mod.db.sql()`
      delete from document_compliance.prescreen_runs where id = ${runId} and owner = ${OWNER}`;
    expect(await mod.repository.loadRun(runId, OWNER)).toBeNull();
    const [row] = await mod.db.sql()<{ count: number }[]>`
      select
        (select count(*) from document_compliance.findings where run_id = ${runId})
        + (select count(*) from document_compliance.documents where run_id = ${runId})
        as count`;
    expect(Number(row?.count)).toBe(0);
  });
});
