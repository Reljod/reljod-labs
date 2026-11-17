import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Runs API with the database and the Workflow SDK faked: a tagged
 * template that records each statement (fragments inlined) and answers it
 * from `state.answer`.
 */

const APPROVAL = "123e4567-e89b-42d3-a456-426614174001";
const RUN = "123e4567-e89b-42d3-a456-426614174002";

type Query = { text: string; values: unknown[] };

const state = vi.hoisted(() => ({
  queries: [] as Query[],
  answer: (_query: Query): unknown[] => [],
  audits: [] as { action: string; detail?: Record<string, unknown> }[],
  auditInFails: false,
  cancelThrows: false,
  started: 0,
  expired: [] as string[],
  runRow: null as Record<string, unknown> | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({
  getRun: () => ({
    cancel: async () => {
      if (state.cancelThrows) throw new Error("workflow already ended");
    },
    getWritable: () => ({
      getWriter: () => ({ write: async () => {}, close: async () => {} }),
    }),
  }),
  resumeHook: async () => {},
  start: async () => {
    state.started += 1;
    return { runId: "wf-1" };
  },
}));
vi.mock("./run-workflow", () => ({ harnessRun: () => {} }));
vi.mock("./db", () => {
  type Fragment = Query & { fragment: true };
  const isFragment = (value: unknown): value is Fragment =>
    typeof value === "object" && value !== null && "fragment" in value;
  const db = ((first: unknown, ...rest: unknown[]) => {
    if (Array.isArray(first) && "raw" in first) {
      let text = "";
      const values: unknown[] = [];
      first.forEach((part: string, index: number) => {
        text += part;
        if (index >= rest.length) return;
        const value = rest[index];
        if (isFragment(value)) {
          text += value.text;
          values.push(...value.values);
        } else {
          text += "$";
          values.push(value);
        }
      });
      const query = {
        fragment: true as const,
        text: text.replace(/\s+/g, " ").trim(),
        values,
      };
      return Object.assign(query, {
        // biome-ignore lint/suspicious/noThenProperty: a fake postgres query is awaited like the real one.
        then(
          resolve: (rows: unknown[]) => unknown,
          reject: (e: unknown) => unknown,
        ) {
          state.queries.push(query);
          try {
            return Promise.resolve(state.answer(query)).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      });
    }
    return { fragment: true, text: "($list)", values: [first] };
  }) as unknown as Record<string, unknown>;
  db.begin = async (fn: (tx: unknown) => unknown) => fn(db);
  return {
    sql: () => db,
    jsonb: (_db: unknown, value: unknown) => value,
    isUuid: (value: unknown) =>
      typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
  };
});
vi.mock("./audit", () => ({
  audit: async (input: { action: string }) => {
    state.audits.push(input);
    return 1;
  },
  auditIn: async (_tx: unknown, input: { action: string }) => {
    if (state.auditInFails) throw new Error("audit insert failed");
    state.audits.push(input);
    return 1;
  },
}));
vi.mock("./rate", () => ({ takeRate: vi.fn(async () => {}) }));
vi.mock("./sessions", () => ({ writableSession: async () => ({ id: null }) }));
vi.mock("./pipelines/source-file", () => ({ sourcesOf: async () => [] }));
vi.mock("./stub", () => ({ modelStubbed: async () => false }));
vi.mock("./pipelines/store", () => ({
  expireRunApprovals: async (_tx: unknown, _owner: unknown, runId: string) => {
    state.expired.push(runId);
  },
  listRunSummaries: async () => [],
  loadRunView: async (_owner: unknown, id: string) => ({ id }),
  runRowOf: async () => state.runRow,
  setRunStatus: async () => true,
}));

import { ForbiddenError, LimitError, StateError } from "./errors";
import { takeRate } from "./rate";
import { decideApproval, startRun, stopRun, sweepStaleRuns } from "./runs";

const admin = { id: "admin-1", role: "admin" as const, name: "Ada" };
const otherAdmin = { id: "admin-2", role: "admin" as const, name: "Bo" };
const user = { id: "user-1", role: "user" as const, name: "Cy" };
const owner = "e2e" as const;

const has = (pattern: RegExp) =>
  state.queries.filter((query) => pattern.test(query.text));

beforeEach(() => {
  state.queries = [];
  state.answer = () => [];
  state.audits = [];
  state.auditInFails = false;
  state.cancelThrows = false;
  state.started = 0;
  state.expired = [];
  state.runRow = null;
  vi.mocked(takeRate).mockClear();
});

describe("decideApproval", () => {
  const pending = (patch: Record<string, unknown> = {}) => ({
    id: APPROVAL,
    run_id: RUN,
    risk: "high",
    status: "pending",
    hook_token: "harness:x:approval",
    title: "Payment instruction",
    kind: "payment_instruction",
    started_by: admin.id,
    session_id: null,
    run_status: "waiting_approval",
    workflow_run_id: "wf-1",
    ...patch,
  });
  const answerWith = (row: Record<string, unknown>) => {
    state.answer = (query) =>
      /from harness\.approvals a/.test(query.text)
        ? [row]
        : /update harness\.approvals/.test(query.text)
          ? [{ id: APPROVAL }]
          : [];
  };

  it("refuses the admin who started the Run a high-risk Approval (four eyes)", async () => {
    answerWith(pending());
    await expect(
      decideApproval({
        owner,
        staff: admin,
        approvalId: APPROVAL,
        decision: "approve",
      } as never),
    ).rejects.toThrow(ForbiddenError);
    expect(has(/update harness\.approvals/)).toHaveLength(0);
  });

  it("refuses a user a high-risk Approval", async () => {
    answerWith(pending({ started_by: "someone-else" }));
    await expect(
      decideApproval({
        owner,
        staff: user,
        approvalId: APPROVAL,
        decision: "approve",
      } as never),
    ).rejects.toThrow(/needs an admin/);
  });

  it("lets another admin decide it, and writes approval.decided", async () => {
    answerWith(pending());
    await decideApproval({
      owner,
      staff: otherAdmin,
      approvalId: APPROVAL,
      decision: "approve",
    } as never);
    expect(state.audits.map((event) => event.action)).toEqual([
      "approval.decided",
    ]);
  });

  it("refuses a second decision with a StateError", async () => {
    answerWith(pending({ status: "approved" }));
    await expect(
      decideApproval({
        owner,
        staff: otherAdmin,
        approvalId: APPROVAL,
        decision: "return",
      } as never),
    ).rejects.toThrow(StateError);
  });

  it("refuses a decision that lost the race to another click", async () => {
    state.answer = (query) =>
      /from harness\.approvals a/.test(query.text) ? [pending()] : [];
    await expect(
      decideApproval({
        owner,
        staff: otherAdmin,
        approvalId: APPROVAL,
        decision: "approve",
      } as never),
    ).rejects.toThrow(/decided a moment ago/);
  });
});

describe("stopRun", () => {
  it("marks the Run stopped even when cancelling its workflow throws", async () => {
    state.cancelThrows = true;
    state.runRow = {
      id: RUN,
      status: "running",
      workflow_run_id: "wf-1",
      pipeline_id: "delinquency_report",
      input: { period: "2025-01" },
      result: null,
      session_id: null,
    };
    await stopRun({ owner, staff: admin, runId: RUN } as never);
    expect(has(/update harness\.runs set status = 'stopped'/)).toHaveLength(1);
    expect(state.expired).toEqual([RUN]);
    expect(state.audits.map((event) => event.action)).toEqual(["run.stopped"]);
  });
});

describe("the stale sweep", () => {
  it("expires the Approvals of the waiting Runs it stops", async () => {
    state.answer = (query) =>
      /status = 'waiting_approval'.*returning id/.test(query.text)
        ? [{ id: "run-a" }, { id: "run-b" }]
        : [];
    await sweepStaleRuns((await import("./db")).sql() as never, owner);
    expect(state.expired).toEqual(["run-a", "run-b"]);
  });
});

describe("startRun", () => {
  const start = () =>
    startRun({
      owner,
      staff: admin,
      visitor: { hash: "v", trusted: false },
      sessionId: null,
      pipelineId: "delinquency_report",
      input: { period: "2025-01" },
      via: "app",
    } as never);

  const counts = () =>
    has(/select count\(\*\)::int as (busy|active) from harness\.runs/);

  it("counts a Workspace's places with one predicate before and under the lock", async () => {
    state.answer = (query) =>
      /insert into harness\.runs/.test(query.text) ? [{ id: RUN }] : [];
    await start();
    const [before, locked] = counts();
    const where = (text: string) => text.slice(text.indexOf("where"));
    expect(before && locked).toBeTruthy();
    expect(where(before?.text ?? "")).toBe(where(locked?.text ?? ""));
    expect(where(before?.text ?? "")).toMatch(/waiting_approval/);
  });

  it("refuses a full Workspace before taking an hourly unit", async () => {
    state.answer = (query) =>
      /as busy from harness\.runs/.test(query.text) ? [{ busy: 3 }] : [];
    await expect(start()).rejects.toThrow(LimitError);
    expect(takeRate).not.toHaveBeenCalled();
  });

  it("applies the Version in force today, not one scheduled for later, and records it", async () => {
    state.answer = (query) => {
      if (/from harness\.rule_versions/.test(query.text)) {
        return [
          {
            rule_id: "dr.missing",
            version: 1,
            enabled: true,
            params: { dueDay: 20 },
            outcome: "refer",
            effective_from: "2099-01-01",
            saved_by: admin.id,
            saved_by_name: admin.name,
            note: null,
            created_at: new Date(),
          },
        ];
      }
      if (/insert into harness\.runs/.test(query.text)) return [{ id: RUN }];
      return [];
    };
    await start();
    const insert = has(/insert into harness\.runs/)[0];
    const versions = insert?.values.find(
      (value) => typeof value === "object" && value && "dr.missing" in value,
    ) as Record<string, number>;
    expect(versions["dr.missing"]).toBe(0);
    const started = state.audits.find(
      (event) => event.action === "run.started",
    );
    expect(started?.detail?.ruleVersions).toMatchObject({ "dr.missing": 0 });
  });

  it("writes run.started in the Run's transaction, and starts nothing when it fails", async () => {
    state.auditInFails = true;
    state.answer = (query) =>
      /insert into harness\.runs/.test(query.text) ? [{ id: RUN }] : [];
    await expect(start()).rejects.toThrow(/audit insert failed/);
    expect(state.started).toBe(0);
  });
});
