import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { LIMITS } from "../../domain/limits";
import { RULES, resolveRules } from "../../domain/rules";
import { freshStages } from "../../domain/run";
import { SAMPLE_PROCESS } from "../../domain/test-fixtures";
import type { AuditInput } from "../audit";
import type {
  Analyst,
  AuditLog,
  RecordingStore,
  RunRepository,
  RunWorkflows,
  SettingsRepository,
} from "../ports";
import type { RunRow } from "../run-row";
import { createPipelineService } from "./pipeline";
import { createRunService, type RunPorts } from "./runs";
import { createSettingsService } from "./settings";

const OWNER: Owner = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c";
const OTHER: Owner = "host:someone-else";
const RUN_ID = "6f1d3c2a-5b4e-4f7a-9c8d-1e2f3a4b5c6d";
const visitor = { hash: "v", trusted: false };
const caller = { owner: OWNER, visitor };

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_ID,
    owner: OWNER,
    visitor_hash: "v",
    source_kind: "sample",
    sample_slug: "contribution-reconciliation",
    recording_path: null,
    recording_name: null,
    recording_type: null,
    status: "completed",
    title: "Run",
    workflow_run_id: "wf-1",
    stages: freshStages().map((stage) => ({ ...stage, status: "done" })),
    watch: null,
    process: null,
    process_checks: [],
    process_findings: [],
    rounds: [],
    approval: null,
    grounding: null,
    rules: resolveRules(),
    rules_version: 0,
    models: {
      watch: "google/gemini-3.8-flash",
      write: "anthropic/claude-haiku-5.5",
      review: "google/gemini-3.8-flash",
    },
    logs: [],
    cost_usd: 0,
    redos: 0,
    error: null,
    created_at: new Date(0),
    started_at: new Date(0),
    completed_at: null,
    ...overrides,
  };
}

/** Fake ports that record what was touched, in order. The Run in `rows` belongs to its `owner`. */
function runPorts(
  options: {
    rows?: RunRow[];
    totals?: Partial<Awaited<ReturnType<RunRepository["workTotals"]>>>;
    active?: { id: string; title: string; started_at: Date }[];
    uploadsToday?: number;
  } = {},
) {
  const calls: string[] = [];
  const lines: AuditInput[] = [];
  const rows = options.rows ?? [];
  const mine = (owner: Owner, id: string) =>
    rows.find((item) => item.id === id && item.owner === owner) ?? null;
  const runs: RunRepository = {
    create: async () => {
      calls.push("create");
      return RUN_ID;
    },
    owned: async (owner, id) => {
      calls.push("owned");
      return mine(owner, id);
    },
    ownedWithCalls: async (owner, id) => {
      calls.push("owned");
      const found = mine(owner, id);
      return found ? { row: found, calls: [] } : null;
    },
    list: async () => [],
    active: async () => {
      calls.push("active");
      return options.active ?? [];
    },
    workTotals: async () => {
      calls.push("totals");
      return {
        ownerSpentToday: 0,
        visitorStartsLastHour: 0,
        startsToday: 0,
        ...options.totals,
      };
    },
    markStopped: async (id, owner) => {
      calls.push("markStopped");
      const found = mine(owner, id);
      return found ? { ...found, status: "stopped" } : null;
    },
    resetForRedo: async () => {
      calls.push("resetForRedo");
      return 1;
    },
    setFields: async () => {
      calls.push("setFields");
    },
    isActiveRunConflict: () => false,
  };
  const audit: AuditLog = {
    person: async (input) => {
      calls.push(`audit:${input.action}`);
      lines.push(input);
    },
    pipeline: async (input) => {
      calls.push(`audit:${input.action}`);
      lines.push(input);
    },
    list: async () => [],
  };
  const store: RecordingStore = {
    uploadUrl: async (path) => {
      calls.push("sign");
      return `https://storage/${path}`;
    },
    objectSize: async () => 1000,
    signedUrl: async () => null,
    uploadsSince: async () => {
      calls.push("uploadsSince");
      return options.uploadsToday ?? 0;
    },
  };
  const workflows: RunWorkflows = {
    start: async () => {
      calls.push("workflow");
      return "wf-new";
    },
    cancel: async () => {
      calls.push("cancel");
      throw new Error("The workflow already ended");
    },
    announceStopped: async () => {
      throw new Error("The stream is closed");
    },
    events: () => new ReadableStream(),
  };
  const ports: RunPorts = {
    runs,
    settings: {
      current: async () => ({
        rules: resolveRules(),
        ruleOverrides: {},
        rulesVersion: 0,
        models: row().models,
      }),
    },
    audit,
    store,
    workflows,
    origin: () => "http://localhost:3000",
    newId: () => "00000000-0000-4000-8000-000000000000",
    now: () => 1_000_000_000_000,
  };
  return { service: createRunService(ports), calls, lines };
}

describe("a Run is only its Owner's", () => {
  it("answers another Owner's Run as not found, on every path by id", async () => {
    const { service, calls } = runPorts({ rows: [row({ owner: OTHER })] });
    for (const attempt of [
      () => service.run(OWNER, RUN_ID),
      () => service.stop(OWNER, RUN_ID),
      () => service.redo(caller, RUN_ID),
      () => service.recordExport(OWNER, RUN_ID, "docx"),
      () => service.events(OWNER, RUN_ID, 0),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
    }
    // Looked up with the caller's Owner, and nothing written for anyone.
    expect(calls.every((call) => call === "owned")).toBe(true);
  });

  it("refuses an upload under another Owner's folder before counting or creating anything", async () => {
    const { service, calls } = runPorts();
    await expect(
      service.start(
        caller,
        {
          kind: "upload",
          path: "recordings/host-someone-else/00000000-0000-4000-8000-000000000000.mp4",
          name: "theirs.mp4",
        },
        "localhost:3000",
      ),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(calls).toEqual([]);
  });

  it("files a new upload under the caller's own folder", async () => {
    const { service } = runPorts();
    const ticket = await service.prepareUpload(caller, {
      name: "call.mp4",
      size: 1000,
      type: "video/mp4",
    });
    expect(ticket.path).toBe(
      "recordings/guest-6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c/00000000-0000-4000-8000-000000000000.mp4",
    );
  });
});

describe("caps are taken before any paid work starts", () => {
  it("refuses a Run over the hourly cap without creating it or starting a workflow", async () => {
    const { service, calls } = runPorts({
      totals: { visitorStartsLastHour: LIMITS.runsPerVisitorPerHour },
    });
    await expect(
      service.start(
        caller,
        { kind: "sample", slug: "contribution-reconciliation" },
        "localhost:3000",
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).not.toContain("create");
    expect(calls).not.toContain("workflow");
  });

  it("refuses a second Run while one is going, even for the e2e suite", async () => {
    const { service, calls } = runPorts({
      active: [{ id: "x", title: "Going", started_at: new Date(1e12) }],
    });
    await expect(
      service.start(
        { owner: OWNER, visitor: { hash: "e2e", trusted: true } },
        { kind: "sample", slug: "contribution-reconciliation" },
        "localhost:3000",
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).not.toContain("create");
  });

  it("refuses a Redo over the spend cap before the Run is reset", async () => {
    const { service, calls } = runPorts({
      rows: [
        row({
          process: {} as never,
          rounds: [],
        }),
      ],
      totals: { ownerSpentToday: LIMITS.spendPerOwnerPerDay },
    });
    await expect(service.redo(caller, RUN_ID)).rejects.toBeInstanceOf(
      LimitError,
    );
    expect(calls).not.toContain("resetForRedo");
    expect(calls).not.toContain("workflow");
  });

  it("refuses an upload once the Owner's daily uploads are used, before signing a URL", async () => {
    const { service, calls } = runPorts({
      uploadsToday: LIMITS.uploadsPerOwnerPerDay,
    });
    await expect(
      service.prepareUpload(caller, {
        name: "call.mp4",
        size: 1000,
        type: "video/mp4",
      }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).not.toContain("sign");
  });
});

describe("Stop is an escape hatch", () => {
  it("marks the row stopped and audits it even when the workflow and its stream are gone", async () => {
    const { service, calls } = runPorts({
      rows: [row({ status: "running" })],
    });
    await service.stop(OWNER, RUN_ID);
    expect(calls).toEqual([
      "owned",
      "markStopped",
      "cancel",
      "audit:run.stopped",
    ]);
  });
});

describe("downloads follow the Approval", () => {
  it("refuses the PPTX of a held Deck and writes no Audit line", async () => {
    const { service, lines } = runPorts({
      rows: [
        row({
          process: {} as never,
          approval: {
            status: "held",
            round: 2,
            at: "2026-11-27T00:00:00Z",
            reason: "x",
          },
        }),
      ],
    });
    await expect(
      service.recordExport(OWNER, RUN_ID, "pptx"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(lines).toEqual([]);
  });
});

describe("settings", () => {
  function settingsPorts() {
    const saved: unknown[] = [];
    const repository: SettingsRepository = {
      of: async () => null,
      save: async (_owner, input) => {
        saved.push(input);
        return { owner: OWNER, rule_overrides: {}, models: {}, version: 1 };
      },
      editRuleOverrides: async () => {
        throw new Error("unused");
      },
    };
    const service = createSettingsService({
      settings: repository,
      audit: { person: async () => {} },
    });
    return { service, saved };
  }

  it("refuses a Watch model that takes no video, and saves nothing", async () => {
    const { service, saved } = settingsPorts();
    await expect(
      service.saveModels(OWNER, {
        watch: "anthropic/claude-haiku-5.5",
        write: "anthropic/claude-haiku-5.5",
        review: "google/gemini-3.8-flash",
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(saved).toEqual([]);
  });

  it("refuses a Rule that does not exist", async () => {
    const { service } = settingsPorts();
    await expect(
      service.saveRule(OWNER, "no.such-rule", null),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(RULES.some((rule) => rule.id === "no.such-rule")).toBe(false);
  });
});

describe("a pass of the pipeline that lost its Run", () => {
  it("writes no verdict and no Audit line once the Run was stopped under it", async () => {
    const lines: AuditInput[] = [];
    let closed = false;
    const stopped = row({
      status: "running",
      process: SAMPLE_PROCESS,
      rounds: [],
    });
    const pipeline = createPipelineService({
      runs: {
        run: async () => stopped,
        status: async () => "stopped",
        claim: async () => true,
      },
      // The row no longer takes this pass's writes.
      feed: {
        publish: async () => false,
        close: async () => {
          closed = true;
        },
      },
      audit: {
        pipeline: async (input) => {
          lines.push(input);
        },
      },
      analyst: {} as Analyst,
      now: () => 0,
    });
    const input = {
      runId: RUN_ID,
      owner: OWNER,
      mode: "full" as const,
      origin: "",
      generation: 0,
    };
    await pipeline.approve(input);
    expect(lines).toEqual([]);
    expect(closed).toBe(true);
    expect(await pipeline.going(RUN_ID, 0)).toBe(false);
  });
});
