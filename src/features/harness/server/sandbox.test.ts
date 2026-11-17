import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_ = "https://runner.example.test";
const SECRET = "0123456789abcdef0123456789abcdef";
const SID = "123e4567-e89b-42d3-a456-426614174000";

const state = vi.hoisted(() => ({
  url: "https://runner.example.test" as string | null,
  secret: "0123456789abcdef0123456789abcdef" as string | null,
  audits: [] as { action: string; detail?: Record<string, unknown> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  env: { sandboxUrl: () => state.url, sandboxSecret: () => state.secret },
}));
vi.mock("./db", () => ({
  isUuid: (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v),
  sql: () => async () => [],
}));
vi.mock("./audit", () => ({
  audit: async (input: {
    action: string;
    detail?: Record<string, unknown>;
  }) => {
    state.audits.push(input);
    return 1;
  },
}));
vi.mock("./rate", () => ({ takeRate: async () => {} }));
vi.mock("./sessions", () => ({
  writableSession: async () => ({ id: "x" }),
  readableSession: async () => ({ id: "x" }),
}));
vi.mock("./context", () => ({ assertCan: () => {} }));

import { InvalidError, LimitError, StateError } from "./errors";
import { sandboxRun, sandboxStatus, sandboxWriteFile } from "./sandbox";

const actor = {
  owner: "host:1",
  staff: { id: "s1", name: "Ada", role: "admin" },
  visitor: { hash: "h", trusted: false },
} as never;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a failure");
}

beforeEach(() => {
  state.url = URL_;
  state.secret = SECRET;
  state.audits = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("sandbox client", () => {
  it("is off when the URL or secret is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    state.url = null;
    const status = await sandboxStatus();
    expect(status.configured).toBe(false);
    expect(status.message).toMatch(/^Sandbox offline/);
    state.url = URL_;
    state.secret = null;
    expect((await sandboxStatus()).configured).toBe(false);
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "ls",
      } as never),
    );
    expect(error).toBeInstanceOf(StateError);
    expect(error.message).toMatch(/^Sandbox offline/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs a command, sends a bearer token, audits and reports sandboxCreated", async () => {
    const fetchMock = vi.fn(async () =>
      reply(200, {
        exitCode: 0,
        stdout: "1\n",
        stderr: "",
        truncated: false,
        timedOut: false,
        durationMs: 12,
        sandboxCreated: true,
        sandboxReset: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const run = await sandboxRun({
      ...(actor as object),
      sessionId: SID,
      command: "echo 1",
      via: "agent",
    } as never);
    expect(run).toMatchObject({ exitCode: 0, sandboxCreated: true, ms: 12 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${URL_}/sessions/${SID}/run`);
    expect((init.headers as Record<string, string>).authorization).toMatch(
      /^Bearer .+\..+$/,
    );
    expect(state.audits.map((a) => a.action)).toEqual([
      "sandbox.started",
      "sandbox.command",
    ]);
    expect(state.audits[1]?.detail).toMatchObject({
      via: "agent",
      exitCode: 0,
    });
  });

  it.each([
    [
      503,
      { error: { code: "at_capacity", message: "full" } },
      StateError,
      /full, try again in a minute/,
    ],
    [
      429,
      { error: { code: "rate_limited", message: "Too many requests" } },
      LimitError,
      /Too many/,
    ],
    [
      400,
      { error: { code: "invalid_path", message: "Path has .." } },
      InvalidError,
      /Path has/,
    ],
    [
      500,
      { error: { code: "internal", message: "boom" } },
      StateError,
      /^Sandbox offline/,
    ],
    [
      401,
      { error: { code: "unauthorized", message: "no" } },
      StateError,
      /^Sandbox offline/,
    ],
  ])("maps a %i answer", async (status, body, cls, message) => {
    vi.stubGlobal("fetch", async () => reply(status, body));
    const error = await failureOf(
      sandboxWriteFile({
        ...(actor as object),
        sessionId: SID,
        path: "a.py",
        content: "x",
      } as never),
    );
    expect(error).toBeInstanceOf(cls);
    expect(error.message).toMatch(message);
  });

  it("says offline on a network failure and never leaks the URL or secret", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError(`connect ECONNREFUSED ${URL_} with ${SECRET}`);
    });
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "ls",
      } as never),
    );
    expect(error.message).toMatch(/^Sandbox offline/);
    expect(error.message).not.toContain("runner.example");
    expect(error.message).not.toContain(SECRET);
  });

  it("scrubs the URL and secret out of a Runner message", async () => {
    vi.stubGlobal("fetch", async () =>
      reply(400, {
        error: { code: "invalid_body", message: `bad ${URL_} ${SECRET}` },
      }),
    );
    const error = await failureOf(
      sandboxWriteFile({
        ...(actor as object),
        sessionId: SID,
        path: "a",
        content: "x",
      } as never),
    );
    expect(error.message).not.toContain("runner.example");
    expect(error.message).not.toContain(SECRET);
  });
});
