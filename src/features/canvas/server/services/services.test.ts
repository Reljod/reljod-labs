import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Access } from "@/features/access/server/gate";
import { ForbiddenError, LimitError, NotFoundError } from "@/platform/errors";
import { STUB_PROBES, STUB_SPEC } from "../../domain/stub";
import { RuleEditRefused, RuleRefusal } from "../errors";
import type {
  Caller,
  ConversationRepository,
  StoredView,
  TrailInput,
  ViewRepository,
} from "../ports";
import { stubSandbox } from "../sandbox/stub";
import { type CanvasPorts, createCanvasServices } from ".";

/*
 * The invariants whose failure makes Canvas wrong, on fake ports: the cap is
 * taken before the first paid step (conventions.md), an Owner reaches only
 * their own rows, the Analyst cannot loosen the Rules that bind it, and a
 * token dies with its Guest pass and cannot ask for the canned adapters.
 */

const me = "guest:6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c" as const;
const someoneElse = "host:someone@example.com" as const;
const visitor = { hash: "v", trusted: false };
const person: Caller = { owner: me, visitor, actor: "person" };
const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const QUESTION = "22222222-2222-4222-8222-222222222222";
const guestAccess: Access = {
  kind: "guest",
  userId: "u1",
  passId: "6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c",
  label: "Guest",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

/** Views in memory, scoped by Owner the way the SQL is. */
function viewStore(): ViewRepository & { rows: StoredView[] } {
  const rows: StoredView[] = [];
  let n = 0;
  return {
    rows,
    get: async (owner, id) =>
      rows.find((row) => row.id === id && owner === ownerOf(row)) ?? null,
    list: async (owner) => rows.filter((row) => ownerOf(row) === owner),
    countInConversation: async () => 0,
    neighbours: async () => [],
    async insert(caller, values, event) {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const row = {
        ...values,
        id,
        conversationId: caller.conversationId ?? null,
        revision: 1,
        createdAt: "2026-11-27T00:00:00.000Z",
        updatedAt: "2026-11-27T00:00:00.000Z",
      } as StoredView;
      owners.set(id, caller.owner);
      rows.push(row);
      event(id);
      return row;
    },
    async update(caller, id, values) {
      const row = rows.find(
        (item) => item.id === id && ownerOf(item) === caller.owner,
      );
      if (!row) return null;
      Object.assign(row, values, { revision: row.revision + 1 });
      return row;
    },
  };
}
const owners = new Map<string, string>();
const ownerOf = (row: StoredView) => owners.get(row.id);

function fakes(overrides: Partial<CanvasPorts> = {}) {
  const calls: string[] = [];
  const events: TrailInput[] = [];
  const trailed: Caller[] = [];
  const views = viewStore();
  const conversations: ConversationRepository = {
    list: async () => [],
    exists: async () => false,
    messages: async () => [],
    fileQuestion: vi.fn(async (_caller, input) => {
      calls.push("file");
      return input.conversationId === undefined
        ? { conversationId: CONVERSATION, questionId: QUESTION, title: "Q" }
        : null;
    }),
    fileAnswer: vi.fn(async () => null),
    sandboxMs: async () => 0,
    spendSandbox: async () => {},
    softDelete: vi.fn(async () => false),
  };
  const ports: CanvasPorts = {
    workspace: { ensure: async () => {} },
    conversations,
    views,
    rulebooks: {
      latest: async () => null,
      history: async () => [],
      save: vi.fn(async (_caller, rulebook, changed) => ({
        version: 1,
        rulebook,
        changed,
        savedAt: "2026-11-27T00:00:00.000Z",
      })),
    },
    uploads: { ready: async () => [] },
    trail: {
      record: async (caller, input) => {
        events.push(input);
        trailed.push(caller);
        return 1;
      },
      strict: async (caller, input) => {
        events.push(input);
        trailed.push(caller);
        return 1;
      },
      list: async () => [],
    },
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
      },
      used: async () => ({ question: 0, run: 0 }),
    },
    sandbox: {
      run: async (owner, job, seconds) => {
        calls.push(`sandbox:${job.op}`);
        return stubSandbox.run(owner, job, seconds);
      },
    },
    analyst: {
      model: () => "stub",
      answer: async function* () {
        calls.push("model");
        yield { type: "text.delta", text: "Done." };
      },
    },
    mcp: async () => {
      throw new Error("no MCP in unit tests");
    },
    access: {
      guestPass: async () => null,
      hostEmails: () => [],
      e2eEnabled: () => true,
    },
    secret: () => "test-salt",
    now: Date.now,
    stub: false,
    ...overrides,
  };
  return { ports, calls, events, trailed, views, conversations };
}

beforeEach(() => owners.clear());

describe("the Run is taken before the Sandbox parses", () => {
  it("a Query the Guard refuses still uses exactly one Run, and is never run", async () => {
    const { ports, calls } = fakes();
    const services = createCanvasServices(ports);
    await expect(
      services.runs.query(person, { sql: STUB_PROBES.rowLevel }),
    ).rejects.toBeInstanceOf(RuleRefusal);
    expect(calls).toEqual(["take:run", "sandbox:serialize"]);
  });

  it("no Sandbox work happens when the allowance is used up", async () => {
    const { ports, calls } = fakes({
      rate: {
        take: async () => {
          throw new LimitError("That's 600 Runs this hour.");
        },
        used: async () => ({ question: 0, run: 0 }),
      },
    });
    const services = createCanvasServices(ports);
    await expect(
      services.runs.query(person, { sql: STUB_PROBES.cardAmounts }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual([]);
  });

  it("a Question past its Sandbox seconds is refused before the Sandbox", async () => {
    const { ports, calls } = fakes();
    ports.conversations.sandboxMs = async () => 120_000;
    const services = createCanvasServices(ports);
    await expect(
      services.runs.query(
        { ...person, questionId: QUESTION },
        { sql: STUB_PROBES.cardAmounts },
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual(["take:run"]);
  });

  it("a fresh Query that runs uses exactly one Run, parse and query together", async () => {
    const { ports, calls } = fakes();
    const services = createCanvasServices(ports);
    const ran = await services.runs.query(person, {
      sql: STUB_PROBES.cardAmounts,
    });
    expect(ran.result.rowCount).toBe(3);
    expect(calls).toEqual(["take:run", "sandbox:serialize", "sandbox:query"]);
  });
});

describe("a Question is capped before it is filed or answered", () => {
  it("takes the Question from the allowance before anything is filed or any model is called", async () => {
    const { ports, calls } = fakes({
      rate: {
        take: async (kind) => {
          calls.push(`take:${kind}`);
          throw new LimitError("That's 20 Questions this hour.");
        },
        used: async () => ({ question: 0, run: 0 }),
      },
    });
    const services = createCanvasServices(ports);
    await expect(
      services.chat.ask(
        guestAccess,
        person,
        { text: "Peak load?" },
        { origin: "http://localhost", signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual(["take:question"]);
  });

  it("refuses a Conversation that is not the Owner's, with no model called", async () => {
    const { ports, calls } = fakes();
    const services = createCanvasServices(ports);
    await expect(
      services.chat.ask(
        guestAccess,
        person,
        { text: "Peak load?", conversationId: CONVERSATION },
        { origin: "http://localhost", signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual(["take:question", "file"]);
  });
});

describe("a Question's answer is saved however the turn ends", () => {
  it("saves what was done when the visitor leaves mid-stream", async () => {
    const { ports, events } = fakes();
    const services = createCanvasServices(ports);
    const controller = new AbortController();
    const stream = await services.chat.ask(
      guestAccess,
      person,
      { text: "Peak load?" },
      { origin: "http://localhost", signal: controller.signal },
    );
    expect((await stream.next()).value).toMatchObject({ type: "question" });
    expect((await stream.next()).value).toMatchObject({ type: "text.delta" });
    // The visitor goes: the request aborts and the stream is closed.
    controller.abort();
    await stream.return(undefined);
    expect(ports.conversations.fileAnswer).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.action)).toContain("question.stopped");
  });
});

describe("an Owner reaches only their own rows", () => {
  it("another Owner's View cannot be shown or changed, and nothing runs for it", async () => {
    const { ports, calls } = fakes();
    const services = createCanvasServices(ports);
    const view = await services.views.create(
      { ...person, owner: someoneElse },
      { spec: STUB_SPEC },
    );
    calls.length = 0;
    await expect(services.views.get(me, view.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      services.views.updateParams(person, {
        viewId: view.id,
        params: { min_peak: 2000 },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });

  it("a Control change is filed under the View's own Conversation, never one the caller names", async () => {
    const { ports, trailed } = fakes();
    const services = createCanvasServices(ports);
    const view = await services.views.create(
      { ...person, conversationId: CONVERSATION },
      { spec: STUB_SPEC },
    );
    trailed.length = 0;
    const changed = await services.views.updateParams(
      { ...person, conversationId: "33333333-3333-4333-8333-333333333333" },
      { viewId: view.id, params: { min_peak: 2000 } },
    );
    expect(changed.view.result.rowCount).toBeLessThan(view.result.rowCount);
    expect(trailed.map((caller) => caller.conversationId)).toEqual(
      trailed.map(() => CONVERSATION),
    );
  });

  it("another Owner's Conversation cannot be opened or deleted", async () => {
    const { ports } = fakes();
    const services = createCanvasServices(ports);
    await expect(
      services.conversations.open(me, CONVERSATION),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      services.conversations.remove(person, CONVERSATION),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the Rules bind the Analyst", () => {
  it("the Analyst cannot save Rules, whatever it sends", async () => {
    const { ports } = fakes();
    const services = createCanvasServices(ports);
    await expect(
      services.rules.save({ ...person, actor: "analyst" }, [
        { id: "access.restricted_columns", params: { columns: [] } },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(ports.rulebooks.save).not.toHaveBeenCalled();
  });

  it("a value out of range is refused naming the field, and nothing is saved", async () => {
    const { ports } = fakes();
    const services = createCanvasServices(ports);
    const refused = services.rules.save(person, [
      { id: "verify.tolerance", params: { percent: 900 } },
    ]);
    await expect(refused).rejects.toBeInstanceOf(RuleEditRefused);
    await expect(refused).rejects.toMatchObject({
      extra: { errors: [expect.objectContaining({ id: "verify.tolerance" })] },
    });
    expect(ports.rulebooks.save).not.toHaveBeenCalled();
  });
});

describe("MCP tokens", () => {
  const pass = (revoked: boolean) => ({
    id: guestAccess.kind === "guest" ? guestAccess.passId : "",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: revoked ? new Date().toISOString() : null,
    deleted_at: null,
  });

  it("a Guest's token stops working the moment their pass is revoked", async () => {
    let revoked = false;
    const { ports } = fakes({
      access: {
        guestPass: async () => pass(revoked),
        hostEmails: () => [],
        e2eEnabled: () => true,
      },
    });
    const services = createCanvasServices(ports);
    const { token } = await services.connect.mint(guestAccess, person);
    expect((await services.connect.bearer(token))?.caller.owner).toBe(me);
    revoked = true;
    expect(await services.connect.bearer(token)).toBeNull();
  });

  it("only a token the stubbed e2e suite minted runs on the canned adapters", async () => {
    const live = createCanvasServices(fakes().ports);
    const stubbed = createCanvasServices(fakes({ stub: true }).ports);
    const e2e: Caller = {
      owner: "e2e",
      visitor: { hash: "e2e", trusted: true },
      actor: "person",
    };
    const fromStub = stubbed.connect.shortToken({ kind: "e2e" }, e2e, "host");
    const fromLive = live.connect.shortToken({ kind: "e2e" }, e2e, "host");
    expect((await live.connect.bearer(fromStub))?.stub).toBe(true);
    expect((await live.connect.bearer(fromLive))?.stub).toBe(false);
    // A Guest's token from stubbed services carries no stub mode at all.
    const guest = stubbed.connect.shortToken(guestAccess, person, "host");
    const read = createCanvasServices(
      fakes({
        access: {
          guestPass: async () => pass(false),
          hostEmails: () => [],
          e2eEnabled: () => true,
        },
      }).ports,
    );
    expect((await read.connect.bearer(guest))?.stub).toBe(false);
  });
});
