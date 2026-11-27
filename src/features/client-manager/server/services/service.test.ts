import { describe, expect, it, vi } from "vitest";
import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { Proposal } from "../../domain/chat";
import type {
  BuildStore,
  BuildWorkflows,
  Caller,
  Caps,
  ClientStore,
  Desk,
  Files,
  Painter,
  ThreadStore,
} from "../ports";
import type { BuildRow, ClientRow, ThreadRow } from "../repository";
import { createBuildService } from "./builds";
import { createClientService } from "./clients";
import { createThreadService } from "./threads";

/*
 * The invariants whose failure makes Client Manager wrong: a client or a
 * Thread reaches only its Owner, a Sample stays read-only, every cap is
 * taken before the paid step, a Stop always closes the row, and a Research
 * card adds its facts once.
 */

const ME: Owner = "host:4b7f0c1e-0000-4000-8000-000000000001";
const OTHER: Owner = "guest:9d3e2f10-0000-4000-8000-000000000002";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const BUILD = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";

const me: Caller = { owner: ME, visitor: { hash: "v", trusted: false } };
const stranger: Caller = {
  owner: OTHER,
  visitor: { hash: "w", trusted: false },
};

function clientRow(over: Partial<ClientRow> = {}): ClientRow {
  return {
    id: CLIENT,
    owner: ME,
    is_sample: false,
    name: "Elena Marsh",
    status: "ready",
    persona: null,
    portrait_path: null,
    portrait_source: null,
    visitor_hash: "v",
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

function buildRow(over: Partial<BuildRow> = {}): BuildRow {
  return {
    id: BUILD,
    client_id: CLIENT,
    workflow_run_id: null,
    trigger: "intake",
    status: "queued",
    stats: null,
    error: null,
    visitor_hash: "v",
    created_at: new Date(),
    finished_at: null,
    ...over,
  };
}

/** Caps that record the order they were taken in, and refuse when told to. */
function caps(log: string[], refuse = false): Caps {
  return {
    async check() {
      log.push("cap");
      if (refuse) throw new LimitError("over");
    },
    async take(_visitor, _owner, _kind, hold) {
      log.push("cap");
      if (refuse) throw new LimitError("over");
      return hold({} as never);
    },
  };
}

const files = (): Files => ({
  uploadUrl: async (path) => `https://upload/${path}`,
  upload: async () => {},
  download: async () => new Uint8Array(),
  signedUrl: async (path) => `https://signed/${path}`,
  signedUrls: async () => new Map(),
  sampleUrl: async (path) => `https://sample/${path}`,
  sampleUrls: async () => new Map(),
  removeFolder: async () => 0,
  exists: async () => true,
});

function clientStore(client: ClientRow | null): ClientStore {
  return {
    get: async () => client,
    file: async () =>
      client && {
        ...client,
        nodes: [],
        sources: [],
        cost: 0,
        tokens: 0,
        edges: 0,
        build: null,
      },
    catalog: async () => [],
    create: async () => CLIENT,
    setStatus: vi.fn(async () => {}),
    setPortrait: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    toPurge: async () => [],
    purge: async () => {},
    edges: async () => [
      {
        id: 1,
        from_key: "client",
        to_key: "person:ivy-marsh",
        relation: "PARENT_OF",
        label: "is the mother of",
        confidence: 0.9,
        quotes: 1,
      },
    ],
    node: async () => null,
    source: async () => null,
  };
}

function buildStore(build: BuildRow | null, client: ClientRow): BuildStore {
  let claimed = false;
  return {
    create: vi.fn(async () => BUILD),
    claim: vi.fn(async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    }),
    get: async () => build,
    withClient: async () =>
      build && {
        ...build,
        client_owner: client.owner,
        client_is_sample: client.is_sample,
      },
    update: vi.fn(async () => {}),
    latest: async () => build,
    createSources: vi.fn(async () => []),
    addMessage: vi.fn(async () => "m"),
  };
}

function workflows(over: Partial<BuildWorkflows> = {}): BuildWorkflows {
  return {
    start: vi.fn(async () => "run-1"),
    cancel: vi.fn(async () => {}),
    announceStopped: vi.fn(async () => {}),
    events: () => new ReadableStream(),
    ...over,
  };
}

function builds(input: {
  client?: ClientRow;
  build?: BuildRow | null;
  log?: string[];
  refuse?: boolean;
  flows?: BuildWorkflows;
}) {
  const client = input.client ?? clientRow();
  const store = buildStore(input.build ?? null, client);
  const clients = clientStore(client);
  const flows = input.flows ?? workflows();
  const service = createBuildService({
    clients,
    builds: store,
    caps: caps(input.log ?? [], input.refuse),
    files: files(),
    workflows: flows,
    now: Date.now,
  });
  return { service, store, clients, flows };
}

describe("a client reaches only its Owner", () => {
  const service = (client: ClientRow) =>
    createClientService({
      clients: clientStore(client),
      files: files(),
      caps: caps([]),
      painter: { paint: vi.fn() },
      later: () => {},
      now: Date.now,
      halt: async () => {},
    });

  it("answers another Owner's client as not there, even though its read ran alongside", async () => {
    const clients = service(clientRow());
    await expect(clients.file(stranger, CLIENT)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      clients.edges(OTHER, CLIENT, { kind: "root" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(clients.remove(stranger, CLIENT)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(
      (await clients.edges(ME, CLIENT, { kind: "root" })).edges,
    ).toHaveLength(1);
  });

  it("shows a Sample to everyone, read-only to all but the trusted seeder", async () => {
    const clients = service(clientRow({ owner: null, is_sample: true }));
    expect((await clients.file(stranger, CLIENT)).canAdd).toBe(false);
    const { shared } = await clients.edges(OTHER, CLIENT, { kind: "root" });
    expect(shared).toBe(true);
    await expect(clients.remove(stranger, CLIENT)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses a legacy row with no Owner", async () => {
    const clients = service(clientRow({ owner: null }));
    await expect(clients.file(me, CLIENT)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("caps come before the paid step", () => {
  it("paints a Portrait only after the cap allowed it", async () => {
    const log: string[] = [];
    const painter: Painter = {
      paint: vi.fn(async () => {
        log.push("paint");
        return {
          image: new Uint8Array(),
          mediaType: "image/png",
          usage: {
            purpose: "portrait" as const,
            model: "m",
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            ms: 0,
          },
        };
      }),
    };
    const persona = {
      archetype: "a",
      headline: "h",
      traits: [],
      communication: "c",
      riskAppetite: "low" as const,
      questions: [],
      portraitPrompt: "a portrait",
    };
    const make = (refuse: boolean) =>
      createClientService({
        clients: clientStore(clientRow({ persona })),
        files: files(),
        caps: caps(log, refuse),
        painter,
        later: () => {},
        now: Date.now,
        halt: async () => {},
      });
    await expect(
      make(true).portrait(me, CLIENT, { mode: "paint" }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(painter.paint).not.toHaveBeenCalled();
    await make(false).portrait(me, CLIENT, { mode: "paint" });
    expect(log).toEqual(["cap", "cap", "paint"]);
  });

  it("refuses a file it cannot read before taking a Build's place", async () => {
    const log: string[] = [];
    const { service, store } = builds({ log });
    await expect(
      service.intake(me, {
        name: "X",
        note: "",
        files: [{ name: "run.exe", type: "application/x-msdownload", size: 9 }],
        portrait: null,
        sample: false,
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(log).toEqual([]);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("asks the Desk only after the question took its place", async () => {
    const log: string[] = [];
    const thread: ThreadRow = {
      id: THREAD,
      owner: ME,
      client_id: null,
      title: "New chat",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const desk: Desk = {
      // biome-ignore lint/correctness/useYield: answers at once
      async *converse() {
        log.push("desk");
        return {
          text: "",
          reasoning: "",
          trail: [],
          cited: [],
          proposal: null,
          buildId: null,
          buildClientId: null,
        };
      },
    };
    const make = (refuse: boolean) =>
      createThreadService({
        threads: threadStore(thread),
        clients: { get: async () => null, catalog: async () => [] },
        caps: caps(log, refuse),
        desk,
        addFacts: vi.fn(),
        now: Date.now,
      });
    await expect(
      make(true).ask(
        me,
        THREAD,
        { text: "Who?", research: false },
        {
          origin: "https://x",
        },
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(log).toEqual(["cap"]);
    for await (const _ of await make(false).ask(
      me,
      THREAD,
      { text: "Who?", research: false },
      { origin: "https://x" },
    )) {
      // drain
    }
    expect(log).toEqual(["cap", "cap", "desk"]);
  });
});

describe("Builds belong to the client's Owner", () => {
  it("keeps a Sample read-only: no cap taken, no Build written", async () => {
    const log: string[] = [];
    const { service, store } = builds({
      client: clientRow({ owner: null, is_sample: true }),
      log,
    });
    await expect(
      service.addition(me, CLIENT, { note: "More", files: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.addFacts(me, CLIENT, { facts: [{ text: "A new fact" }] }, "chat"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(log).toEqual([]);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("starts or stops nobody else's Build, and starts one only once", async () => {
    const { service, flows } = builds({ build: buildRow() });
    await expect(service.start(stranger, BUILD)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.stop(stranger, BUILD)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await service.start(me, BUILD);
    await service.start(me, BUILD);
    expect(flows.start).toHaveBeenCalledTimes(1);
  });

  it("refuses a second Build while one is running", async () => {
    const { service } = builds({
      build: buildRow({ status: "running", workflow_run_id: "run-1" }),
    });
    await expect(
      service.addition(me, CLIENT, { note: "More", files: [] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("closes a stopped Build's row even when its workflow cannot be cancelled", async () => {
    const flows = workflows({
      cancel: vi.fn(async () => {
        throw new Error("already over");
      }),
      announceStopped: vi.fn(async () => {
        throw new Error("stream closed");
      }),
    });
    const { service, store, clients } = builds({
      build: buildRow({ status: "running", workflow_run_id: "run-1" }),
      flows,
    });
    await service.stop(me, BUILD);
    expect(store.update).toHaveBeenCalledWith(BUILD, {
      status: "stopped",
      error: "Stopped by the person",
    });
    expect(clients.setStatus).toHaveBeenCalledWith(CLIENT, "failed");
  });
});

function threadStore(
  thread: ThreadRow | null,
  proposal: Proposal | null = null,
): ThreadStore {
  let open = proposal?.status === "open";
  return {
    create: async () => {
      throw new Error("unused");
    },
    get: async () => thread,
    list: async () => [],
    update: async () => {},
    remove: vi.fn(async () => {}),
    addMessage: async () => "m",
    messages: async () => [],
    history: async () => [],
    message: async () =>
      proposal && {
        id: MESSAGE,
        role: "assistant",
        mode: "research",
        content: "",
        client_id: CLIENT,
        traversal: null,
        proposal,
        build_id: null,
        created_at: new Date(),
      },
    decide: vi.fn(async () => {
      if (!open) return false;
      open = false;
      return true;
    }),
    setProposal: vi.fn(async () => {}),
  };
}

describe("Threads reach only their Owner", () => {
  const thread: ThreadRow = {
    id: THREAD,
    owner: ME,
    client_id: null,
    title: "Chat",
    created_at: new Date(),
    updated_at: new Date(),
  };
  const proposal: Proposal = {
    clientId: CLIENT,
    clientName: "Elena Marsh",
    status: "open",
    added: [],
    buildId: null,
    facts: [
      {
        id: "f1",
        text: "Sits on a board",
        certainty: "high",
        sourceUrl: "https://example.com/a",
        sourceTitle: "Example",
      },
    ],
  };

  it("answers another Owner's Thread as not there", async () => {
    const threads = createThreadService({
      threads: threadStore(thread, proposal),
      clients: { get: async () => null, catalog: async () => [] },
      caps: caps([]),
      desk: { converse: vi.fn() },
      addFacts: vi.fn(),
      now: Date.now,
    });
    await expect(threads.get(OTHER, THREAD)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(threads.remove(OTHER, THREAD)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      threads.ask(
        stranger,
        THREAD,
        { text: "Hi", research: false },
        {
          origin: "https://x",
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      threads.decide(stranger, THREAD, MESSAGE, {
        action: "add",
        factIds: ["f1"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("adds a Research card's facts once, and hands the card back when the addition fails", async () => {
    const addFacts = vi.fn(async () => ({
      buildId: BUILD,
      clientId: CLIENT,
      clientName: "Elena Marsh",
    }));
    const store = threadStore(thread, proposal);
    const threads = createThreadService({
      threads: store,
      clients: { get: async () => null, catalog: async () => [] },
      caps: caps([]),
      desk: { converse: vi.fn() },
      addFacts,
      now: Date.now,
    });
    const first = await threads.decide(me, THREAD, MESSAGE, {
      action: "add",
      factIds: ["f1"],
    });
    expect(first.proposal).toMatchObject({ status: "added", buildId: BUILD });
    // The second click loses the claim: no second Build.
    const again = createThreadService({
      threads: { ...store, message: threadStore(thread, proposal).message },
      clients: { get: async () => null, catalog: async () => [] },
      caps: caps([]),
      desk: { converse: vi.fn() },
      addFacts,
      now: Date.now,
    });
    await expect(
      again.decide(me, THREAD, MESSAGE, { action: "add", factIds: ["f1"] }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(addFacts).toHaveBeenCalledTimes(1);

    const failing = threadStore(thread, proposal);
    await expect(
      createThreadService({
        threads: failing,
        clients: { get: async () => null, catalog: async () => [] },
        caps: caps([]),
        desk: { converse: vi.fn() },
        addFacts: async () => {
          throw new ForbiddenError("read-only");
        },
        now: Date.now,
      }).decide(me, THREAD, MESSAGE, { action: "add", factIds: ["f1"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(failing.setProposal).toHaveBeenCalledWith(MESSAGE, proposal);
  });
});
