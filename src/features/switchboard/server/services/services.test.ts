import { describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { NEW_CALL_STATE } from "../../domain/backoffice";
import type { CallEvent, CallView } from "../../domain/contract";
import { LIMITS } from "../../domain/limits";
import { STUB_MODEL } from "../../domain/models";
import { DEFAULT_RULEBOOK } from "../../domain/rules";
import { readMcpToken } from "../../domain/token";
import type {
  AgentPart,
  Caller,
  SwitchboardPorts,
  SwitchboardStore,
  TextAgent,
} from "../ports";
import { createSwitchboardServices } from ".";

vi.mock("server-only", () => ({}));

const CALL_ID = "0b7f4a2e-3c1d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_CALL = "1c8a5b3f-4d2e-4f60-9bac-1d2e3f4a5b6c";
const SECRET = "test-secret";
const NOW = Date.parse("2026-11-27T10:00:00Z");

const caller: Caller = {
  owner: "guest:4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  visitor: { hash: "v1", trusted: false },
};

function callView(patch: Partial<CallView> = {}): CallView {
  return {
    id: CALL_ID,
    line: "text",
    origin: "app",
    status: "live",
    endReason: null,
    model: "anthropic/claude-haiku-5.5",
    scenario: { kind: "open" },
    rulebook: DEFAULT_RULEBOOK,
    state: NEW_CALL_STATE,
    consentAudio: false,
    hasAudio: false,
    usage: {},
    costUsd: 0,
    wrapup: null,
    wrapupStatus: "none",
    deadlineAt: new Date(NOW + 5 * 60_000).toISOString(),
    startedAt: new Date(NOW - 10_000).toISOString(),
    endedAt: null,
    ...patch,
  };
}

const event = (type: string, data: unknown = {}): CallEvent =>
  ({
    id: 1,
    callId: CALL_ID,
    actor: "system",
    type,
    data,
    at: new Date(NOW).toISOString(),
  }) as CallEvent;

/** A store holding one Call of `caller`'s Owner; every other Owner sees nothing. */
function fakeStore(call: CallView = callView()): SwitchboardStore {
  const mine = (owner: string, id: string) =>
    owner === caller.owner && id === call.id ? call : null;
  return {
    ensureWorkspace: vi.fn(async () => {}),
    resetRecords: vi.fn(async () => true),
    records: vi.fn(async () => []),
    bookingExists: vi.fn(async () => true),
    trail: vi.fn(async () => []),
    ruleRows: vi.fn(async () => []),
    addRuleVersion: vi.fn(async () => 2),
    emit: vi.fn(async (_owner, _callId, _actor, type, data) =>
      event(type, data),
    ) as SwitchboardStore["emit"],
    calls: vi.fn(async () => []),
    call: vi.fn(async (owner, id) => mine(owner, id)),
    events: vi.fn(async () => []),
    liveCallId: vi.fn(async () => null),
    open: vi.fn(async () => ({ call, replaced: [] })),
    attachRun: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    end: vi.fn(async () => ({ ...call, status: "ended" as const })),
    tool: vi.fn(async () => ({
      ok: true,
      output: {},
      summary: "done",
      events: [],
      over: null,
    })),
    report: vi.fn(async () => ({
      accepted: 0,
      status: "live" as const,
      costUsd: 0,
      cut: false,
    })),
    recordTurn: vi.fn(async () => "recorded" as const),
    addCost: vi.fn(async () => 0),
    cutOff: vi.fn(async () => true),
    openWrapup: vi.fn(async () => true),
    saveWrapup: vi.fn(async () => null),
    failWrapup: vi.fn(async () => {}),
    callbackDue: vi.fn(async () => {}),
  };
}

function agentOf(parts: AgentPart[]): TextAgent {
  return {
    model: "anthropic/claude-haiku-5.5",
    turn: vi.fn(async function* () {
      for (const part of parts) yield part;
    }),
  };
}

function setup(overrides: Partial<SwitchboardPorts> = {}, store = fakeStore()) {
  const ports: SwitchboardPorts = {
    store,
    rate: {
      take: vi.fn(async () => {}),
      takeVoiceCall: vi.fn(async () => {}),
      used: vi.fn(async () => ({
        call: { used: 0, perHour: LIMITS.callsPerHour },
        turn: { used: 0, perHour: LIMITS.turnsPerHour },
      })),
    },
    agent: agentOf([{ kind: "delta", text: "Hello." }]),
    sessions: { grant: vi.fn(async () => ({}) as never) },
    notes: {
      model: "model/notes",
      write: vi.fn(async () => ({
        text: "{}",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      })),
    },
    sandbox: { run: vi.fn() },
    lifecycles: {
      start: vi.fn(async () => "run-1"),
      wake: vi.fn(async () => {}),
      callbackNow: vi.fn(async () => true),
    },
    access: {
      secret: () => SECRET,
      hostEmails: () => ["host@example.com"],
      e2e: () => true,
      guestPass: vi.fn(async () => ({
        id: "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        expires_at: new Date(NOW + 86_400_000).toISOString(),
        revoked_at: null,
        deleted_at: null,
      })),
    },
    sandboxConfigured: () => false,
    stub: false,
    now: () => NOW,
    ...overrides,
  };
  return { ports, services: createSwitchboardServices(ports) };
}

async function drain(turn: AsyncGenerator<unknown>) {
  const parts: unknown[] = [];
  for await (const part of turn) parts.push(part);
  return parts;
}

describe("a Call's caps come before what they pay for", () => {
  it("takes the voice caps before any Call or Session exists, and a refusal opens neither", async () => {
    const { ports, services } = setup();
    vi.mocked(ports.rate.takeVoiceCall).mockRejectedValue(
      new LimitError("No more voice Calls today."),
    );
    await expect(
      services.calls.start(caller, {
        line: "voice",
        origin: "app",
        scenario: { kind: "open" },
      }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(ports.store.open).not.toHaveBeenCalled();
    expect(ports.sessions.grant).not.toHaveBeenCalled();
    expect(ports.rate.take).not.toHaveBeenCalled();
  });

  it("checks a Booking before the cap, so a typo spends nothing", async () => {
    const { ports, services } = setup();
    vi.mocked(ports.store.bookingExists).mockResolvedValue(false);
    await expect(
      services.calls.start(caller, {
        line: "text",
        origin: "app",
        scenario: { kind: "own", bookingRef: "MR-NOPE00", issue: "delay" },
      }),
    ).rejects.toBeInstanceOf(InvalidError);
    expect(ports.rate.take).not.toHaveBeenCalled();
  });

  it("takes the Turn cap before the Agent is asked", async () => {
    const { ports, services } = setup();
    vi.mocked(ports.rate.take).mockRejectedValue(new LimitError("Too many."));
    await expect(
      services.calls.turn(caller, CALL_ID, "Hello?", "text"),
    ).rejects.toBeInstanceOf(LimitError);
    expect(ports.agent.turn).not.toHaveBeenCalled();
  });

  it("refuses a Turn on a Call past its deadline without asking the model", async () => {
    const { ports, services } = setup(
      {},
      fakeStore(callView({ deadlineAt: new Date(NOW - 1).toISOString() })),
    );
    await expect(
      services.calls.turn(caller, CALL_ID, "Hello?", "text"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(ports.agent.turn).not.toHaveBeenCalled();
  });

  it("books a Turn's cost and cuts the Call off at its spend cap", async () => {
    const { ports, services } = setup({
      agent: agentOf([
        { kind: "delta", text: "Let me look." },
        {
          kind: "paid",
          model: "m",
          inputTokens: 10,
          outputTokens: 10,
          costUsd: 0.5,
        },
      ]),
    });
    vi.mocked(ports.store.addCost).mockResolvedValue(LIMITS.usdPerCall);
    await drain(await services.calls.turn(caller, CALL_ID, "Hi", "text"));
    expect(ports.store.addCost).toHaveBeenCalledWith(
      caller.owner,
      CALL_ID,
      0.5,
    );
    expect(ports.store.cutOff).toHaveBeenCalled();
    expect(ports.lifecycles.wake).toHaveBeenCalledWith(CALL_ID);
  });

  it("takes the Turn cap for every tool call, before the Back office", async () => {
    const { ports, services } = setup();
    vi.mocked(ports.rate.take).mockRejectedValue(new LimitError("Too many."));
    await expect(
      services.calls.tool(caller, CALL_ID, {
        toolCallId: "t1",
        name: "issue_refund",
        args: {},
      }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(ports.store.tool).not.toHaveBeenCalled();
  });
});

describe("a Call never runs without its Workflow", () => {
  it("marks the Call failed and says so when the Workflow cannot start", async () => {
    const { ports, services } = setup();
    vi.mocked(ports.lifecycles.start).mockRejectedValue(new Error("down"));
    await expect(
      services.calls.start(caller, {
        line: "text",
        origin: "app",
        scenario: { kind: "open" },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(ports.store.fail).toHaveBeenCalledWith(
      caller.owner,
      CALL_ID,
      expect.any(String),
    );
    expect(ports.store.emit).not.toHaveBeenCalled();
  });

  it("hangs up a voice Call whose Session could not be granted", async () => {
    const store = fakeStore(callView({ line: "voice" }));
    const { ports, services } = setup({}, store);
    vi.mocked(ports.sessions.grant).mockRejectedValue(new Error("mint"));
    await expect(
      services.calls.start(caller, {
        line: "voice",
        origin: "app",
        scenario: { kind: "open" },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(store.end).toHaveBeenCalledWith(
      caller.owner,
      CALL_ID,
      "client",
      "The Session could not open.",
    );
  });
});

describe("Owner scope", () => {
  const stranger: Caller = {
    owner: "host:9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
    visitor: caller.visitor,
  };

  it("does not show another Owner's Call", async () => {
    const { services } = setup();
    await expect(
      services.calls.get(stranger.owner, CALL_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      services.calls.get(caller.owner, OTHER_CALL),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not wake another Owner's Callback", async () => {
    const { ports, services } = setup();
    await expect(
      services.calls.callbackNow(stranger.owner, CALL_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ports.lifecycles.callbackNow).not.toHaveBeenCalled();
  });
});

describe("Rule edits", () => {
  it("refuses an edit that fails its schema with every error, and saves nothing", async () => {
    const { ports, services } = setup();
    const refused = await services.rules
      .save(caller.owner, {
        ruleId: "refund.limits",
        enabled: "yes",
        params: { bogus: 1 },
      })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(InvalidError);
    expect((refused as InvalidError).extra?.errors).toHaveLength(2);
    expect(ports.store.addRuleVersion).not.toHaveBeenCalled();
  });

  it("refuses a Rule that already keeps its last Version", async () => {
    const { ports, services } = setup();
    vi.mocked(ports.store.addRuleVersion).mockResolvedValue(null);
    await expect(
      services.rules.restore(caller.owner, "refund.limits"),
    ).rejects.toBeInstanceOf(LimitError);
  });
});

describe("MCP tokens", () => {
  const guest = {
    kind: "guest" as const,
    userId: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
    passId: "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    label: "Guest",
    expiresAt: new Date(NOW + 86_400_000).toISOString(),
  };

  it("mints a Guest's token for their Owner, dying with their pass", async () => {
    const { services } = setup();
    const minted = await services.connect.mint(
      guest,
      caller.owner,
      caller.visitor,
    );
    const claims = readMcpToken(minted.token, SECRET, NOW);
    expect(claims?.owner).toBe(caller.owner);
    expect(claims?.exp).toBe(Math.floor(Date.parse(guest.expiresAt) / 1000));
    expect(claims?.stub).toBeUndefined();
  });

  it("turns a token away once its Guest pass is revoked", async () => {
    const { ports, services } = setup();
    const { token } = await services.connect.mint(
      guest,
      caller.owner,
      caller.visitor,
    );
    expect(await services.connect.authenticate(token)).not.toBeNull();
    vi.mocked(ports.access.guestPass).mockResolvedValue({
      id: guest.passId,
      expires_at: guest.expiresAt,
      revoked_at: new Date(NOW - 1000).toISOString(),
      deleted_at: null,
    });
    expect(await services.connect.authenticate(token)).toBeNull();
  });

  it("keeps the stubbed services only for an e2e token the stubbed suite minted", async () => {
    const stubbed = setup({ stub: true }).services;
    const live = setup().services;
    const e2e = { hash: "e2e", trusted: true };
    const fromStub = await stubbed.connect.mint({ kind: "e2e" }, "e2e", e2e);
    const fromLive = await live.connect.mint({ kind: "e2e" }, "e2e", e2e);
    expect((await live.connect.authenticate(fromStub.token))?.stub).toBe(true);
    expect((await live.connect.authenticate(fromLive.token))?.stub).toBe(false);
    const host = await stubbed.connect.mint(
      { kind: "host", userId: "u", email: "host@example.com", name: "" },
      "host:u",
      caller.visitor,
    );
    expect(readMcpToken(host.token, SECRET, NOW)?.stub).toBeUndefined();
  });
});

describe("the Wrap-up's note", () => {
  const said = [event("turn.caller", { text: "Hi" })];

  it("never asks the model for a Call the stubbed suite started", async () => {
    const store = fakeStore(callView({ model: STUB_MODEL, status: "ended" }));
    vi.mocked(store.events).mockResolvedValue(said);
    const { ports, services } = setup({}, store);
    const note = await services.wrapup.note(caller.owner, CALL_ID);
    expect(note.model).toBe("code");
    expect(ports.notes.write).not.toHaveBeenCalled();
  });

  it("does not pay twice when its step is retried", async () => {
    const store = fakeStore(callView({ status: "ended" }));
    vi.mocked(store.events).mockResolvedValue([
      ...said,
      event("model.call", { purpose: "wrapup" }),
    ]);
    const { ports, services } = setup({}, store);
    await services.wrapup.note(caller.owner, CALL_ID);
    expect(ports.notes.write).not.toHaveBeenCalled();
  });
});
