import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ownerSpent: 0,
  sessionSpent: 0,
  turn: { taken: true } as { taken: true } | { refusal: string },
  run: { runId: "run-1" } as { runId: string } | { refusal: string },
  turnCalls: [] as unknown[],
  runCalls: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({
  getRun: vi.fn(),
  resumeHook: vi.fn(),
  start: vi.fn(async () => ({ runId: "wf-1" })),
}));
vi.mock("./run-workflow", () => ({ caseworkRun: {} }));
vi.mock("./repository", () => ({
  activeRuns: async () => [],
  closeStoppedRun: async () => {},
  documentsByIds: async (ids: string[]) =>
    ids.map((id) => ({ id, name: `doc ${id}` })),
  getQuestion: async () => null,
  getRun: async () => null,
  orgModelSettings: async () => ({}),
  ownerSpendUsd: async () => db.ownerSpent,
  sessionSpend: async () =>
    db.sessionSpent > 0 ? [{ costUsd: db.sessionSpent }] : [],
  takeChatTurn: async (input: unknown) => {
    db.turnCalls.push(input);
    return db.turn;
  },
  createRun: async (input: unknown) => {
    db.runCalls.push(input);
    return db.run;
  },
  updateRun: async () => {},
}));

const { checkSpend, LIMITS, LimitError, startRun, takeChatTurn } = await import(
  "./runs"
);

const session = {
  id: "11111111-1111-4111-8111-111111111111",
  visitor_hash: "visitor",
  owner: "host:11111111-2222-4333-8444-555555555555",
  model_overrides: {},
  title: null,
  created_at: "",
  last_active_at: "",
} as const;

beforeEach(() => {
  db.ownerSpent = 0;
  db.sessionSpent = 0;
  db.turn = { taken: true };
  db.run = { runId: "run-1" };
  db.turnCalls = [];
  db.runCalls = [];
});

describe("checkSpend", () => {
  it("lets work start under both caps", async () => {
    await expect(checkSpend(session)).resolves.toBeUndefined();
  });

  it("refuses once the Owner's Desks together have spent the daily cap", async () => {
    db.ownerSpent = LIMITS.spendPerOwnerPerDay;
    await expect(checkSpend(session)).rejects.toThrow(/daily cap/);
  });

  it("never offers a new desk when the Owner's cap is reached", async () => {
    db.ownerSpent = LIMITS.spendPerOwnerPerDay;
    db.sessionSpent = LIMITS.spendPerSession;
    const error = await checkSpend(session).catch((caught) => caught);
    expect(error).toBeInstanceOf(LimitError);
    expect(error.message).not.toMatch(/new desk/);
  });

  it("offers a new desk when only this Desk's cap is reached", async () => {
    db.sessionSpent = LIMITS.spendPerSession;
    await expect(checkSpend(session)).rejects.toThrow(/new desk/);
  });

  it("skips the caps for the e2e suite", async () => {
    db.ownerSpent = 100;
    await expect(
      checkSpend({ ...session, visitor_hash: "e2e" }),
    ).resolves.toBeUndefined();
  });
});

describe("takeChatTurn", () => {
  it("passes every cap to the database", async () => {
    await takeChatTurn(session);
    expect(db.turnCalls[0]).toMatchObject({
      limits: {
        perVisitorPerHour: LIMITS.messagesPerVisitorPerHour,
        perDay: LIMITS.chatTurnsPerDay,
        ownerSpendPerDay: LIMITS.spendPerOwnerPerDay,
        sessionSpend: LIMITS.spendPerSession,
      },
    });
  });

  it("passes no caps for the e2e suite", async () => {
    await takeChatTurn({ ...session, visitor_hash: "e2e" });
    expect(db.turnCalls[0]).toMatchObject({ limits: null });
  });

  it("refuses with the words for each cap", async () => {
    db.turn = { refusal: "visitor" };
    await expect(takeChatTurn(session)).rejects.toThrow(/messages this hour/);
    db.turn = { refusal: "day" };
    await expect(takeChatTurn(session)).rejects.toThrow(/today/);
    db.turn = { refusal: "owner_spend" };
    const error = await takeChatTurn(session).catch((caught) => caught);
    expect(error.message).toMatch(/daily cap/);
    expect(error.message).not.toMatch(/new desk/);
    db.turn = { refusal: "session_spend" };
    db.sessionSpent = 2.5;
    await expect(takeChatTurn(session)).rejects.toThrow(/\$2\.50/);
  });
});

describe("startRun", () => {
  it("takes the rate limits with the insert", async () => {
    const started = await startRun(session, { documentIds: ["a"] });
    expect(started.runId).toBe("run-1");
    expect(db.runCalls[0]).toMatchObject({
      limits: {
        perVisitorPerHour: LIMITS.runsPerVisitorPerHour,
        perDay: LIMITS.runsPerDay,
      },
    });
  });

  it("refuses when the database says a limit is reached", async () => {
    db.run = { refusal: "visitor" };
    await expect(startRun(session, { documentIds: ["a"] })).rejects.toThrow(
      /runs this hour/,
    );
    db.run = { refusal: "active" };
    await expect(startRun(session, { documentIds: ["a"] })).rejects.toThrow(
      /already has a run going/,
    );
  });

  it("refuses before the insert once the Owner's spend cap is reached", async () => {
    db.ownerSpent = LIMITS.spendPerOwnerPerDay;
    await expect(startRun(session, { documentIds: ["a"] })).rejects.toThrow(
      LimitError,
    );
    expect(db.runCalls).toHaveLength(0);
  });
});
