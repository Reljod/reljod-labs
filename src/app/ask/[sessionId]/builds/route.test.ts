import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  access: null as null | { kind: "host"; userId: string },
  limitStarted: false,
  onLimitStarted: () => {},
  limitStartedSignal: Promise.resolve(),
  limitFails: false,
  loads: [] as { id: string; owner: string }[],
  runs: [] as { owner: string; limit: Promise<string | null> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/access/server/gate", () => ({
  accessOrDenied: async () =>
    state.access ?? new Response("denied", { status: 401 }),
}));
vi.mock("@/features/ledger/server/visitor", () => ({
  currentVisitor: async () => ({
    hash: "visitor",
    limited: true,
    stubbed: false,
    forceLimit: false,
  }),
}));
vi.mock("@/features/ledger/server/rate-limit", () => ({
  rateLimitMessage: async () => {
    state.limitStarted = true;
    state.onLimitStarted();
    if (state.limitFails) throw new Error("count failed");
    return null;
  },
}));
vi.mock("@/features/ledger/server/repository", () => ({
  loadAskSession: async (id: string, owner: string) => {
    state.loads.push({ id, owner });
    // The session waits for the rate-limit count to start: a route that
    // counted only after loading would never get here.
    await state.limitStartedSignal;
    return owner === "host:owner-a" ? { id, builds: [] } : null;
  },
}));
vi.mock("@/features/ledger/server/run-build", () => ({
  runBuild: (input: { owner: string; limit: Promise<string | null> }) => {
    state.runs.push(input);
    return new ReadableStream({ start: (c) => c.close() });
  },
}));

const { POST } = await import("./route");

const ask = (question: unknown = "Where has Reljod worked?") =>
  POST(
    new Request(`http://test/ask/${SESSION}/builds`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
    { params: Promise.resolve({ sessionId: SESSION }) },
  );

beforeEach(() => {
  state.access = { kind: "host", userId: "owner-a" };
  state.limitStarted = false;
  state.limitStartedSignal = new Promise((resolve) => {
    state.onLimitStarted = resolve;
  });
  state.limitFails = false;
  state.loads = [];
  state.runs = [];
});

describe("POST /ask/[sessionId]/builds", () => {
  it("turns away a visitor without access before reading anything", async () => {
    state.access = null;
    const response = await ask();
    expect(response.status).toBe(401);
    expect(state.loads).toEqual([]);
    expect(state.limitStarted).toBe(false);
  });

  it("refuses an empty question", async () => {
    expect((await ask("   ")).status).toBe(400);
    expect(state.loads).toEqual([]);
  });

  it("answers another Owner's session as missing", async () => {
    state.access = { kind: "host", userId: "owner-b" };
    const response = await ask();
    expect(response.status).toBe(404);
    expect(state.loads).toEqual([{ id: SESSION, owner: "host:owner-b" }]);
    expect(state.runs).toEqual([]);
  });

  it("streams a Build for the Owner, handing it the rate limit already in flight", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]?.owner).toBe("host:owner-a");
    await expect(state.runs[0]?.limit).resolves.toBeNull();
  });

  it("leaves a failed count to the stream, without an unhandled rejection", async () => {
    state.limitFails = true;
    state.access = { kind: "host", userId: "owner-b" };
    expect((await ask()).status).toBe(404);
  });
});
