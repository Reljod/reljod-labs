import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_ = "https://runner.example.test";
const SECRET = "0123456789abcdef0123456789abcdef";
const SID = "123e4567-e89b-42d3-a456-426614174000";

const state = vi.hoisted(() => ({
  url: "https://runner.example.test" as string | null,
  secret: "0123456789abcdef0123456789abcdef" as string | null,
  audits: [] as { action: string; detail?: Record<string, unknown> }[],
  strictFails: false,
  queries: [] as { text: string; values: unknown[] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  env: { sandboxUrl: () => state.url, sandboxSecret: () => state.secret },
}));
vi.mock("./db", () => ({
  isUuid: (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v),
  sql:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.queries.push({ text: strings.join("?"), values });
      return [];
    },
}));
vi.mock("./audit", () => ({
  audit: async (input: {
    action: string;
    detail?: Record<string, unknown>;
  }) => {
    state.audits.push(input);
    return 1;
  },
  auditStrict: async (input: {
    action: string;
    detail?: Record<string, unknown>;
  }) => {
    if (state.strictFails) throw new Error("insert failed");
    state.audits.push(input);
  },
}));
vi.mock("./rate", () => ({ takeRate: async () => {} }));
vi.mock("./sessions", () => ({
  writableSession: async () => ({ id: "x" }),
  readableSession: async () => ({ id: "x" }),
}));
vi.mock("./context", () => ({ assertCan: () => {} }));

import { sandboxOwnerTag } from "../domain/sandbox-token";
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
  state.strictFails = false;
  state.queries = [];
});

const claimsOf = (init: RequestInit) => {
  const bearer = (init.headers as Record<string, string>).authorization;
  const payload = bearer.replace(/^Bearer /, "").split(".")[0] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
};
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
      "sandbox.command",
      "sandbox.started",
      "sandbox.command_finished",
    ]);
    expect(state.audits[0]?.detail).toMatchObject({
      via: "agent",
      command: "echo 1",
    });
    expect(state.audits[2]?.detail).toMatchObject({
      via: "agent",
      exitCode: 0,
    });
    // The token carries an opaque Owner tag, never the Owner.
    const claims = claimsOf(init);
    expect(claims).toMatchObject({
      sid: SID,
      act: "run",
      own: sandboxOwnerTag(SECRET, "host:1"),
    });
    expect(JSON.stringify(claims)).not.toContain("host:1");
    // The real container name is kept.
    const insert = state.queries.find((q) =>
      q.text.includes("insert into harness.sandboxes"),
    );
    expect(insert?.values).toContain(`harness-sbx-${SID}`);
  });

  it("does not run a command whose Audit event cannot be written", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    state.strictFails = true;
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "rm -rf data",
      } as never),
    );
    expect(error).toBeInstanceOf(StateError);
    expect(error.message).toMatch(/not run/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("audits every file written, with its path and size and never its content", async () => {
    vi.stubGlobal("fetch", async () =>
      reply(200, { path: "src/a.py", bytes: 9, sandboxCreated: false }),
    );
    await sandboxWriteFile({
      ...(actor as object),
      sessionId: SID,
      path: "./src/a.py",
      content: "TOP-SECRET",
      via: "agent",
    } as never);
    expect(state.audits.map((a) => a.action)).toEqual(["sandbox.file_written"]);
    expect(state.audits[0]?.detail).toEqual({
      via: "agent",
      path: "src/a.py",
      bytes: 9,
    });
    expect(JSON.stringify(state.audits)).not.toContain("TOP-SECRET");
  });

  it("maps the Runner's per-Owner cap to a plain message", async () => {
    vi.stubGlobal("fetch", async () =>
      reply(429, {
        error: {
          code: "owner_at_capacity",
          message: "You already have 2 Sandboxes running; ...",
        },
      }),
    );
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "ls",
      } as never),
    );
    expect(error).toBeInstanceOf(LimitError);
    // No numbers: the Runner reads the cap and the idle time from its config.
    expect(error.message).not.toMatch(/\d|two/);
    expect(error.message).toMatch(/already have as many Sandboxes/);
  });

  it.each([
    [
      "the Runner is offline",
      async () => {
        throw new TypeError("connect ECONNREFUSED");
      },
      /^Sandbox offline/,
    ],
    [
      "the Owner is at the cap",
      async () =>
        reply(429, { error: { code: "owner_at_capacity", message: "x" } }),
      /as many Sandboxes/,
    ],
    [
      "the Runner refuses the body",
      async () =>
        reply(400, { error: { code: "invalid_body", message: "bad input" } }),
      /bad input/,
    ],
  ])("records that a command did not run when %s", async (_, fetchImpl, message) => {
    vi.stubGlobal("fetch", fetchImpl);
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "python main.py",
        via: "agent",
      } as never),
    );
    expect(error.message).toMatch(message);
    expect(state.audits.map((a) => a.action)).toEqual([
      "sandbox.command",
      "sandbox.command_finished",
    ]);
    const asked = state.audits[0] as { summary?: string };
    expect(asked.summary).toBe("Asked to run: python main.py");
    expect(asked.summary).not.toMatch(/^Ran:/);
    expect(state.audits[1]?.detail).toMatchObject({ via: "agent" });
    expect(String(state.audits[1]?.detail?.error)).toMatch(message);
    expect(JSON.stringify(state.audits)).not.toContain("runner.example");
  });

  it("records no file written when the write fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("connect ECONNREFUSED");
    });
    const error = await failureOf(
      sandboxWriteFile({
        ...(actor as object),
        sessionId: SID,
        path: "a.py",
        content: "x",
      } as never),
    );
    expect(error.message).toMatch(/^Sandbox offline/);
    expect(state.audits.map((a) => a.action)).not.toContain(
      "sandbox.file_written",
    );
  });

  it.each([
    ["http://runner.example.test", false],
    ["ftp://runner.example.test", false],
    ["not a url", false],
    ["https://user:pw@runner.example.test", false],
    ["https://runner.example.test", true],
    ["http://127.0.0.1:8787", true],
    ["http://localhost:8787", true],
    ["http://[::1]:8787", true],
  ])("treats %s as usable: %s", async (url, usable) => {
    const fetchMock = vi.fn(async () => reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    state.url = url;
    const status = await sandboxStatus();
    expect(status.configured).toBe(usable);
    if (!usable) {
      expect(status.message).toMatch(/^Sandbox offline: its address/);
      expect(status.message).not.toContain("runner.example");
      expect(fetchMock).not.toHaveBeenCalled();
      const error = await failureOf(
        sandboxRun({
          ...(actor as object),
          sessionId: SID,
          command: "ls",
        } as never),
      );
      expect(error.message).toMatch(/^Sandbox offline: its address/);
    }
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
