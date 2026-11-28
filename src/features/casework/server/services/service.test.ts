import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConflictError, LimitError, NotFoundError } from "@/platform/errors";
import { LIMITS } from "../../domain/limits";
import { DEFAULT_SETTINGS } from "../../domain/model-config";
import type { DocumentRow, RunRow, SessionRow } from "../repository";
import { createChatService } from "./chat";
import { createDeskService } from "./desks";
import { createRunService, E2E_VISITOR_HASH, type RunPorts } from "./runs";
import { createUploadService } from "./uploads";

const OWNER = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const OTHER = "host:11111111-2222-4333-8444-555555555555" as const;
const visitor = { hash: "v", trusted: false };

const desk: SessionRow = {
  id: "11111111-1111-4111-8111-111111111111",
  visitor_hash: "v",
  owner: OWNER,
  model_overrides: {},
  title: null,
  created_at: "",
  last_active_at: "",
};
const otherDesk: SessionRow = {
  ...desk,
  id: "22222222-2222-4222-8222-222222222222",
  owner: OTHER,
};

const doc = (id: string) => ({ id, name: `doc ${id}` }) as DocumentRow;
const run = (patch: Partial<RunRow> = {}): RunRow => ({
  id: "33333333-3333-4333-8333-333333333333",
  session_id: desk.id,
  pipeline: null,
  jobs: ["sort"],
  document_ids: [],
  status: "running",
  workflow_run_id: "wf-1",
  state: null,
  recommendation: null,
  error: null,
  created_at: new Date().toISOString(),
  completed_at: null,
  ...patch,
});

/** Run service ports that record what reached the outside world. */
function runPorts(overrides: Partial<RunPorts> = {}) {
  const calls: string[] = [];
  const created: unknown[] = [];
  const ports: RunPorts = {
    runs: {
      create: async (input) => {
        created.push(input);
        calls.push("create");
        return { runId: "run-1" };
      },
      get: async () => run(),
      update: async () => {},
      ofDesk: async () => [],
      withCosts: async () => [],
      active: async () => [],
      closeStopped: async () => {},
      recordJob: async () => {},
      createQuestion: async () => "q",
      question: async () => null,
      openQuestions: async () => [],
      markAnswered: async () => {},
    },
    cabinet: { byIds: async (ids) => ids.map(doc) },
    desks: { openOf: async () => desk },
    spend: { ofDesk: async () => [], ofOwner: async () => 0 },
    workflows: {
      start: async () => {
        calls.push("workflow");
        return "wf-1";
      },
      cancel: async () => {
        calls.push("cancel");
      },
      announceStopped: async () => {},
      events: () => new ReadableStream(),
      resume: async () => {
        calls.push("resume");
      },
    },
    settings: async () => DEFAULT_SETTINGS,
    now: Date.now,
    ...overrides,
  };
  return { ports, calls, created };
}

describe("a Run starts only within the caps, before anything is paid for", () => {
  it("passes every cap to the insert, and starts the workflow after it", async () => {
    const { ports, calls, created } = runPorts();
    await createRunService(ports).start(desk, { documentIds: ["a"] });
    expect(calls).toEqual(["create", "workflow"]);
    expect(created[0]).toMatchObject({
      sessionId: desk.id,
      owner: OWNER,
      limits: {
        perVisitorPerHour: LIMITS.runsPerVisitorPerHour,
        perDay: LIMITS.runsPerDay,
        ownerSpendPerDay: LIMITS.spendPerOwnerPerDay,
        sessionSpend: LIMITS.spendPerSession,
      },
    });
  });

  it("never starts the workflow when a cap refuses the Run", async () => {
    for (const [refusal, error] of [
      ["visitor", LimitError],
      ["owner_spend", LimitError],
      ["session_spend", LimitError],
      ["active", ConflictError],
    ] as const) {
      const { ports, calls } = runPorts();
      ports.runs.create = async () => ({ refusal });
      await expect(
        createRunService(ports).start(desk, { documentIds: ["a"] }),
      ).rejects.toBeInstanceOf(error);
      expect(calls).not.toContain("workflow");
    }
  });

  it("refuses before the insert when none of the Documents are the Desk's to use", async () => {
    const { ports, calls } = runPorts({ cabinet: { byIds: async () => [] } });
    await expect(
      createRunService(ports).start(desk, { documentIds: ["a"] }),
    ).rejects.toThrow(/None of those documents/);
    expect(calls).toEqual([]);
  });

  it("caps a Run at its Documents, and lifts the caps only for the e2e suite's Desk", async () => {
    const asked: string[][] = [];
    const { ports, created } = runPorts({
      cabinet: {
        byIds: async (ids) => {
          asked.push(ids);
          return ids.map(doc);
        },
      },
    });
    const ids = Array.from({ length: 30 }, (_, index) => `d${index}`);
    await createRunService(ports).start(
      { ...desk, visitor_hash: E2E_VISITOR_HASH },
      { documentIds: ids },
    );
    expect(asked[0]).toHaveLength(LIMITS.documentsPerRun);
    expect(created[0]).toMatchObject({ limits: null });
  });
});

describe("a Run is reached only through its own Desk", () => {
  const theirs = run({ session_id: otherDesk.id });

  it("will not stop another Desk's Run", async () => {
    const { ports, calls } = runPorts();
    ports.runs.get = async () => theirs;
    await expect(
      createRunService(ports).stop(desk, theirs.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });

  it("will not stream another Desk's Run", async () => {
    const { ports } = runPorts();
    ports.runs.get = async () => theirs;
    await expect(
      createRunService(ports).events(OWNER, null, theirs.id, 0),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("will not answer another Desk's Question, and caps an Answer's Documents", async () => {
    const { ports, calls } = runPorts();
    const question = {
      id: "q",
      run_id: theirs.id,
      job: "sort" as const,
      token: "t",
      prompt: "",
      wants: { kinds: [], options: [] },
      answer: null,
      created_at: "",
      answered_at: null,
    };
    ports.runs.question = async () => ({
      ...question,
      session_id: otherDesk.id,
    });
    await expect(
      createRunService(ports).answer(desk, "q", { skip: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);

    const asked: { ids: string[]; deskId: string | null }[] = [];
    ports.runs.question = async () => ({ ...question, session_id: desk.id });
    ports.cabinet.byIds = async (ids, deskId) => {
      asked.push({ ids, deskId });
      return ids.map(doc);
    };
    await createRunService(ports).answer(desk, "q", {
      documentIds: Array.from({ length: 12 }, (_, index) => `d${index}`).concat(
        "d0",
      ),
    });
    expect(asked[0]?.deskId).toBe(desk.id);
    expect(asked[0]?.ids.length).toBeLessThanOrEqual(LIMITS.documentsPerRun);
    expect(calls).toEqual(["resume"]);
  });

  it("closes the Run even when its workflow already ended", async () => {
    const { ports } = runPorts();
    const updates: unknown[] = [];
    ports.workflows.cancel = async () => {
      throw new Error("already ended");
    };
    ports.runs.update = async (_id, patch) => {
      updates.push(patch);
    };
    const stopped = await createRunService(ports).stop(desk, run().id);
    expect(stopped).toMatchObject({ stopped: true, status: "stopped" });
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "stopped" }),
    );
  });
});

describe("a Desk is opened only for its Owner", () => {
  function deskService() {
    return createDeskService({
      desks: {
        create: async () => desk.id,
        get: async (id) =>
          [desk, otherDesk].find((row) => row.id === id) ?? null,
        openOf: async () => desk,
        listWithSpend: async () => [],
        touch: async () => {},
        setModelOverrides: async () => {},
        orgModelSettings: async () => ({}),
        external: async () => "x",
      },
      cabinet: {
        caseFiles: async () => [],
        seedDocuments: async () => [],
        cabinetOf: async () => [],
        uploadsOf: async () => [],
        byIds: async () => [],
        candidates: async () => [],
        asOf: async () => "",
        countUploads: async () => 0,
        recordedPaths: async () => new Set(),
        insertUploads: async () => [],
      },
      runs: { withCosts: async () => [] },
      messages: { recent: async () => [] },
      spend: { ofDesk: async () => [], byDesk: async () => new Map() },
      storage: {
        signedUrls: async () => new Map(),
        signedUploadUrl: async () => "",
        stored: async () => null,
        text: async () => null,
      },
    });
  }

  it("refuses to open another Owner's Desk by its id", async () => {
    await expect(
      deskService().open({ owner: OWNER, visitor }, null, otherDesk.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a session token once its Desk is not the token's Owner's", async () => {
    const service = deskService();
    await expect(service.forToken(otherDesk.id, OWNER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.forToken(desk.id, null)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.forToken(desk.id, OWNER)).resolves.toBe(desk);
  });
});

describe("a chat message takes its caps before the Specialist's model", () => {
  function chat(refusal: "visitor" | "session_spend" | null) {
    const reached: string[] = [];
    const turns: unknown[] = [];
    const service = createChatService({
      spend: {
        takeChatTurn: async (input) => {
          turns.push(input);
          return refusal ? { refusal } : { taken: true };
        },
        ofDesk: async () => [
          {
            purpose: "chat",
            model: "m",
            calls: 1,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 2.5,
          },
        ],
      },
      messages: {
        add: async () => {
          reached.push("message");
          return 1;
        },
        recent: async () => [],
      },
      cabinet: { byIds: async () => [], caseFiles: async () => [] },
      runs: { ofDesk: async () => [], openQuestions: async () => [] },
      desks: { touch: async () => {} },
      stopActive: async () => ({ runId: null, stopped: false }),
      settings: async () => DEFAULT_SETTINGS,
      specialist: () => {
        reached.push("model");
        throw new Error("unused");
      },
      connect: async () => {
        reached.push("mcp");
        throw new Error("unused");
      },
      track: async () => {
        throw new Error("unused");
      },
    });
    return { service, reached, turns };
  }

  it("refuses with the cap's words before anything else is touched", async () => {
    const { service, reached } = chat("visitor");
    await expect(
      service.turn({ owner: OWNER, visitor }, desk, {
        text: "hello",
        documentIds: [],
        origin: "http://localhost",
      }),
    ).rejects.toThrow(/messages this hour/);
    expect(reached).toEqual([]);
  });

  it("says what this Desk spent when its own cap refuses", async () => {
    const { service } = chat("session_spend");
    await expect(
      service.turn({ owner: OWNER, visitor }, desk, {
        text: "hello",
        documentIds: [],
        origin: "http://localhost",
      }),
    ).rejects.toThrow(/\$2\.50/);
  });

  it("counts the turn against the visitor sending it, and lifts the caps only for the e2e suite", async () => {
    const { service, turns } = chat(null);
    await service.turn({ owner: OWNER, visitor }, desk, {
      text: "hello",
      documentIds: [],
      origin: "http://localhost",
    });
    await service.turn(
      { owner: "e2e", visitor: { hash: "e2e", trusted: true } },
      desk,
      { text: "hello", documentIds: [], origin: "http://localhost" },
    );
    expect(turns[0]).toMatchObject({
      session: { id: desk.id, visitor_hash: "v" },
      limits: { perVisitorPerHour: LIMITS.messagesPerVisitorPerHour },
    });
    expect(turns[1]).toMatchObject({ limits: null });
  });
});

describe("an upload is recorded only from its own Desk's ticket, once", () => {
  function uploads(recorded = new Set<string>()) {
    const inserted: { storagePath: string; sessionId: string }[] = [];
    const service = createUploadService({
      cabinet: {
        countUploads: async () => 0,
        recordedPaths: async () => recorded,
        insertUploads: async (rows) => {
          inserted.push(...rows);
          return [];
        },
      },
      storage: {
        signedUrls: async () => new Map(),
        signedUploadUrl: async (path) => `https://storage/${path}`,
        // A real JPEG, within the cap.
        stored: async () => ({
          size: 1000,
          head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        }),
        text: async () => null,
      },
      secret: () => "test-secret",
      newId: () => "00000000-0000-4000-8000-000000000000",
      now: () => 1_000_000,
    });
    return { service, inserted };
  }
  const photo = {
    name: "id.jpg",
    type: "image/jpeg",
    size: 1000,
    pages: 0,
    digital: false,
  };

  it("files a slot under the Desk's own folder, and records it from its ticket", async () => {
    const { service, inserted } = uploads();
    const [slot] = await service.begin(desk, [photo]);
    if (!slot?.ok) throw new Error("no slot");
    expect(slot.fileUrl).toContain(`uploads/${desk.id}/`);
    await service.finish(desk, [slot.ticket]);
    expect(inserted).toEqual([expect.objectContaining({ sessionId: desk.id })]);
  });

  it("ignores a ticket of another Desk, a forged one and one already used", async () => {
    const { service: theirs } = uploads();
    const [slot] = await theirs.begin(otherDesk, [photo]);
    if (!slot?.ok) throw new Error("no slot");
    const [payload] = slot.ticket.split(".");

    const { service, inserted } = uploads();
    await service.finish(desk, [slot.ticket, `${payload}.forged`]);
    expect(inserted).toEqual([]);

    const [mine] = await service.begin(desk, [photo]);
    if (!mine?.ok) throw new Error("no slot");
    const path = `uploads/${desk.id}/00000000-0000-4000-8000-000000000000/id.jpg`;
    const { service: used, inserted: again } = uploads(new Set([path]));
    await used.finish(desk, [mine.ticket, mine.ticket]);
    expect(again).toEqual([]);
  });
});
