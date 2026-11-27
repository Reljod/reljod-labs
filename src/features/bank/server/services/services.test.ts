import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LimitError, NotFoundError } from "@/platform/errors";
import type { SessionSummary } from "../../domain/chat";
import type { Staff } from "../../domain/staff";
import type {
  BankRate,
  SessionRepository,
  StaffContext,
  StaffRepository,
} from "../ports";
import { createChatService } from "./chat";
import { createCommandService } from "./commands";
import { createSessionService } from "./sessions";
import { createStaffService } from "./staff";

/*
 * The bank's services with fake ports: the invariants that live in the
 * harness rather than in the database (the ledger's own are tested against
 * Postgres in core/bank.db.test.ts).
 */

const owner = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const visitor = { hash: "v", trusted: false };
const SESSION = "11111111-1111-4111-8111-111111111111";

const teller: Staff = {
  id: "00000000-0000-4000-8000-000000000001",
  key: "ines-maro",
  name: "Ines Maro",
  title: "Branch teller",
  role: "teller",
  initials: "IM",
};
const supervisor: Staff = {
  ...teller,
  id: "00000000-0000-4000-8000-000000000002",
  key: "tomas-vell",
  name: "Tomas Vell",
  role: "supervisor",
};

const context: StaffContext = {
  access: { kind: "e2e" },
  owner,
  staff: teller,
  everyone: [teller, supervisor],
  visitor,
};

const refusing: BankRate = {
  take: async () => {
    throw new LimitError("That's the limit.");
  },
  used: async () => ({ message: 0, write: 0, sandbox: 0 }),
};

function recordingRate(calls: string[]): BankRate {
  return {
    take: async (kind) => {
      calls.push(`take:${kind}`);
    },
    used: async () => ({ message: 0, write: 0, sandbox: 0 }),
  };
}

const session: SessionSummary = {
  id: SESSION,
  title: "New conversation",
  staffId: teller.id,
  customerId: null,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
};

function sessionRepo(
  calls: string[],
  overrides: Partial<SessionRepository> = {},
): SessionRepository {
  return {
    list: async () => [],
    find: async () => session,
    count: async () => 0,
    create: async () => {
      calls.push("create");
      return session;
    },
    remove: async () => true,
    rename: async () => session,
    messages: async () => [],
    append: async (message) => {
      calls.push(`append:${message.role}`);
      return "m";
    },
    confirmations: async () => [],
    ...overrides,
  };
}

describe("a write is capped before the engine runs", () => {
  it("takes the visitor's write cap first, and a refusal never reaches the engine or the outbox", async () => {
    const calls: string[] = [];
    const service = createCommandService({
      engine: {
        read: async () => calls.push("read"),
        write: async () => {
          calls.push("engine");
          return { status: "done", message: "ok", result: null };
        },
      },
      growth: { view: async () => ({}) as never },
      outbox: { kick: async () => void calls.push("kick") },
      rate: refusing,
      later: () => {},
    });
    await expect(
      service.write(
        { actor: { owner, staff: teller, via: "app" }, visitor },
        "transfer",
        {},
        "key-12345",
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });
});

describe("a Teller turn spends nothing it should not", () => {
  const unusedTeller = {
    answer: () => {
      throw new Error("the Teller must not run");
    },
  };

  it("refuses another Owner's Session before taking the cap, saving or reaching the model", async () => {
    const calls: string[] = [];
    const service = createChatService({
      sessions: sessionRepo(calls, { find: async () => null }),
      rate: recordingRate(calls),
      teller: unusedTeller,
    });
    await expect(
      service.turn({
        context,
        sessionId: SESSION,
        text: "Hello",
        origin: "http://localhost",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });

  it("takes the message cap before the message is saved, and a refusal never reaches the model", async () => {
    const calls: string[] = [];
    const service = createChatService({
      sessions: sessionRepo(calls),
      rate: refusing,
      teller: unusedTeller,
    });
    await expect(
      service.turn({
        context,
        sessionId: SESSION,
        text: "Hello",
        origin: "http://localhost",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });

  it("caps the Sandbox per visitor, through the turn the Teller is handed", async () => {
    const calls: string[] = [];
    const service = createChatService({
      sessions: sessionRepo(calls),
      rate: recordingRate(calls),
      teller: {
        async *answer(turn) {
          await turn.spend("sandbox");
          yield await turn.finish("done", [], null);
        },
      },
    });
    const events = [];
    for await (const event of await service.turn({
      context,
      sessionId: SESSION,
      text: "Chart her spending",
      origin: "http://localhost",
      signal: new AbortController().signal,
    }))
      events.push(event);
    expect(calls).toEqual([
      "take:message",
      "append:person",
      "take:sandbox",
      "append:teller",
    ]);
    expect(events.at(-1)).toEqual({ type: "done", messageId: "m" });
  });
});

describe("Staff are the Owner's own", () => {
  const repo: StaffRepository = {
    open: async () => [teller, supervisor],
    find: async () => null,
  };
  const service = (record = vi.fn(async () => {})) =>
    createStaffService({
      staff: repo,
      audit: { record },
      tokens: {
        client: () => ({ token: "tdw_x", expiresAt: 1 }),
        chat: () => "tdw_y",
      },
      mcpPath: "/api/bank/mcp",
    });

  it("ignores a Staff cookie that names no Staff member of this bank", async () => {
    const signed = await service().signIn(
      { access: { kind: "e2e" }, owner, visitor },
      "00000000-0000-4000-8000-0000000000ff",
    );
    expect(signed.staff).toEqual(teller);
    const chosen = await service().signIn(
      { access: { kind: "e2e" }, owner, visitor },
      supervisor.id,
    );
    expect(chosen.staff).toEqual(supervisor);
  });

  it("refuses to switch to someone outside the bank, and writes nothing", async () => {
    const record = vi.fn(async () => {});
    await expect(
      service(record).switchTo(context, "00000000-0000-4000-8000-0000000000ff"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(record).not.toHaveBeenCalled();
  });

  it("hands over no MCP token unless its Audit event was written", async () => {
    const record = vi.fn(async () => {
      throw new Error("audit down");
    });
    await expect(
      service(record).connect(context, "http://localhost"),
    ).rejects.toThrow("audit down");
  });

  it("an MCP token whose Staff member left the bank acts for no one", async () => {
    expect(
      await service().caller({
        kind: "guest",
        owner,
        staffId: teller.id,
        visitor: "v",
        via: "mcp",
        exp: 0,
      }),
    ).toBeNull();
  });
});

describe("conversations", () => {
  it("are capped per bank before one is created", async () => {
    const calls: string[] = [];
    const service = createSessionService({
      sessions: sessionRepo(calls, { count: async () => 30 }),
      sandboxes: { dispose: async () => {} },
      later: (work) => void work(),
    });
    await expect(service.create(context, null)).rejects.toBeInstanceOf(
      LimitError,
    );
    expect(calls).toEqual([]);
  });

  it("are deleted only by their Owner, and only then is the Sandbox let go", async () => {
    const dispose = vi.fn(async () => {});
    const service = createSessionService({
      sessions: sessionRepo([], { remove: async () => false }),
      sandboxes: { dispose },
      later: (work) => void work(),
    });
    await expect(service.remove(owner, SESSION)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(dispose).not.toHaveBeenCalled();
  });
});
