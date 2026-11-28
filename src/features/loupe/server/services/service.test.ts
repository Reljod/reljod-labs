import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConflictError, LimitError, NotFoundError } from "@/platform/errors";
import { DEFAULT_RULEBOOK } from "../../domain/rules";
import { type ExaminationRow, emptyState } from "../examination";
import type { Caller, LoupePorts, Who } from "../ports";
import { createLoupeServices } from ".";

const OWNER = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const OTHER = "host:11111111-1111-4111-8111-111111111111" as const;
const ID = "22222222-2222-4222-8222-222222222222";
const visitor = { hash: "v", trusted: false };
const who: Who = { owner: OWNER, visitor, origin: "", via: "app" };
const client: Caller = {
  owner: OWNER,
  visitor,
  role: { kind: "client" },
  origin: "",
};

function row(overrides: Partial<ExaminationRow> = {}): ExaminationRow {
  return {
    id: ID,
    owner: OWNER,
    title: "Payslip",
    kind: "payslip",
    format: "pdf",
    source: { kind: "sample", sampleId: "lp-tr-payslip-01" },
    is_forgery: false,
    status: "completed",
    model: "m",
    examiner: true,
    rulebook_version: 0,
    rulebook: DEFAULT_RULEBOOK,
    workflow_run_id: null,
    cost_usd: 0,
    pages: [{ page: 1, width: 100, height: 100, image: "pages/p1.jpg" }],
    state: emptyState({ driver: "sweep" }),
    findings: [],
    verdict: {
      verdict: "genuine",
      reasons: [],
      counted: { decisive: 0, supporting: 0 },
    } as unknown as ExaminationRow["verdict"],
    score: null,
    gate: null,
    stopped_by: null,
    error: null,
    visitor_hash: "v",
    via: "app",
    started_at: new Date().toISOString(),
    ended_at: null,
    ...overrides,
  };
}

/** Every port fails loudly unless a test gives it; `calls` records what was reached. */
function ports(overrides: Partial<LoupePorts> = {}) {
  const calls: string[] = [];
  const unexpected = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} was not expected`);
  };
  const owned = (found: ExaminationRow | null) => async (owner: string) =>
    found && found.owner === owner ? found : null;
  const base: LoupePorts = {
    examinations: {
      create: unexpected("create"),
      get: unexpected("get"),
      owned: owned(row()),
      owns: async (owner) => owner === OWNER,
      pulse: unexpected("pulse"),
      list: unexpected("list"),
      update: async () => {
        calls.push("update");
      },
      endIfGoing: unexpected("endIfGoing"),
      mutate: unexpected("mutate"),
    },
    trail: {
      append: async () => {
        calls.push("trail");
      },
      after: async () => [],
      all: async () => [],
    },
    rulebooks: {
      list: unexpected("rulebooks.list"),
      current: async () => {
        calls.push("rulebook");
        return {
          version: 1,
          rulebook: DEFAULT_RULEBOOK,
          createdAt: "",
          note: null,
          changes: [],
        };
      },
      insert: unexpected("rulebooks.insert"),
    },
    uploads: {
      insert: unexpected("uploads.insert"),
      owned: async () => null,
      list: unexpected("uploads.list"),
    },
    audit: {
      ensureOwner: async () => {},
      append: async () => {
        calls.push("audit");
      },
      list: unexpected("audit.list"),
    },
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
      },
      used: async () => ({ check: 0, reevaluate: 0, token: 0 }),
    },
    store: {
      download: async () => {
        calls.push("download");
        return Buffer.from("x");
      },
      upload: unexpected("upload"),
      signedUpload: unexpected("signedUpload"),
      storedSize: unexpected("storedSize"),
    },
    samples: unexpected("samples"),
    sandbox: {
      live: true,
      prepare: unexpected("sandbox"),
      sweep: unexpected("sandbox"),
      check: unexpected("sandbox"),
      code: unexpected("sandbox"),
      crop: unexpected("sandbox"),
      dispose: async () => {},
    },
    model: { turn: unexpected("model") },
    runs: {
      start: async () => {
        calls.push("workflow");
        return "run";
      },
      cancel: async () => {},
    },
    mcp: unexpected("mcp"),
    secret: () => "s",
    modelFor: () => "m",
    stub: false,
    now: Date.now,
    strictTrail: true,
  };
  return {
    services: createLoupeServices({ ...base, ...overrides }),
    calls,
    base,
  };
}

describe("Loupe reaches only the Owner's own Examinations", () => {
  it("answers another Owner's Examination as not found, before any cap or Sandbox", async () => {
    const { services, calls } = ports();
    const stranger: Caller = { ...client, owner: OTHER };
    await expect(
      services.tools.runCheck(stranger, {
        examinationId: ID,
        check: "pdf_structure",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      services.examinations.reevaluate({ ...who, owner: OTHER }, ID),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });

  it("keeps the in-app Examiner's token to the one Examination it was made for", async () => {
    const { services, calls } = ports();
    const examiner: Caller = {
      ...client,
      role: {
        kind: "examiner",
        examinationId: "33333333-3333-4333-8333-333333333333",
      },
    };
    await expect(
      services.tools.look(examiner, { examinationId: ID, page: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });

  it("never reads a Storage key built from a bad id or key", async () => {
    const { services, calls } = ports();
    await expect(
      services.examinations.asset(OWNER, "../../u/x", "pages/p1.jpg"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      services.examinations.asset(OWNER, ID, "../pages/p1.jpg"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
    await expect(
      services.examinations.asset(OTHER, ID, "pages/p1.jpg"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Loupe takes its caps before it spends", () => {
  it("takes a client's Check cap before the Sandbox, and a refusal runs nothing", async () => {
    const { services, calls } = ports({
      rate: {
        take: async () => {
          throw new LimitError("That's 30 Checks this hour. Try again later.");
        },
        used: async () => ({ check: 0, reevaluate: 0, token: 0 }),
      },
    });
    await expect(
      services.tools.runCheck(client, {
        examinationId: ID,
        check: "pdf_structure",
      }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });

  it("starts no workflow when a limit refuses the Examination", async () => {
    const created: unknown[] = [];
    const { calls, base } = ports();
    const limited = createLoupeServices({
      ...base,
      examinations: {
        ...base.examinations,
        create: async (input) => {
          created.push(input.limits);
          return { over: "hour", count: 4 };
        },
      },
    });
    await expect(
      limited.examinations.start(who, {
        source: { kind: "sample", sampleId: "lp-tr-payslip-01" },
      }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(created[0]).not.toBeNull();
    expect(calls).not.toContain("workflow");
  });

  it("refuses an Upload before any row when there is no Sandbox to examine it", async () => {
    const { base } = ports();
    const services = createLoupeServices({
      ...base,
      sandbox: { ...base.sandbox, live: false },
      uploads: {
        ...base.uploads,
        owned: async () => ({
          id: ID,
          owner: OWNER,
          title: "Mine",
          kind: "payslip",
          format: "pdf",
          content_type: "application/pdf",
          bytes: 10,
          storage_path: "u/x/y.pdf",
          forgery: null,
          created_at: "",
        }),
      },
      store: { ...base.store, storedSize: async () => 10 },
    });
    await expect(
      services.examinations.start(who, {
        source: { kind: "upload", uploadId: ID },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("re-evaluates only a completed Examination, and takes its cap first", async () => {
    const { base, calls } = ports();
    const running = createLoupeServices({
      ...base,
      examinations: {
        ...base.examinations,
        owned: async () => row({ status: "running" }),
      },
    });
    await expect(
      running.examinations.reevaluate(who, ID),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toEqual([]);

    const { services, calls: done } = ports();
    const result = await services.examinations.reevaluate(who, ID);
    expect(result).toMatchObject({ fromVersion: 0, toVersion: 1 });
    expect(done.indexOf("take:reevaluate")).toBeGreaterThanOrEqual(0);
    expect(done.indexOf("take:reevaluate")).toBeLessThan(
      done.indexOf("update"),
    );
  });
});
