import { beforeEach, describe, expect, it, vi } from "vitest";

const SID = "123e4567-e89b-42d3-a456-426614174000";

const state = vi.hoisted(() => ({
  configured: true,
  audits: [] as { action: string; detail?: Record<string, unknown> }[],
  strictFails: false,
  queries: [] as { text: string; values: unknown[] }[],
  rateTaken: 0,
}));

const sdk = vi.hoisted(() => ({
  getOrCreate: vi.fn(),
  get: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { getOrCreate: sdk.getOrCreate, get: sdk.get },
}));
vi.mock("./env", () => ({
  env: { sandboxConfigured: () => state.configured },
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
vi.mock("./rate", () => ({
  takeRate: async () => {
    state.rateTaken += 1;
  },
}));
vi.mock("./sessions", () => ({
  writableSession: async () => ({ id: SID }),
  readableSession: async () => ({ id: SID }),
}));

import { sessionSandboxName } from "../domain/sandbox";
import { InvalidError, NotFoundError, StateError } from "./errors";
import {
  sandboxListFiles,
  sandboxReadFile,
  sandboxRun,
  sandboxWriteFile,
} from "./sandbox";

/** A user, not an admin: every Role may use the Sandbox. */
const actor = {
  owner: "guest:1",
  staff: { id: "s1", name: "Keisha", role: "user" },
  visitor: { hash: "h", trusted: false },
} as never;

function fakeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    expiresAt: new Date(Date.now() + 9 * 60_000),
    update: vi.fn(async () => {}),
    extendTimeout: vi.fn(async () => {}),
    writeFiles: vi.fn(async () => {}),
    readFileToBuffer: vi.fn(async () => Buffer.from("a,b\n1,2\n")),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () => "42\n",
      stderr: async () => "",
    })),
    stop: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

/** `getOrCreate` that makes a new Sandbox (calls `onCreate`) or finds one. */
function opens(sandbox: ReturnType<typeof fakeSandbox>, made: boolean) {
  sdk.getOrCreate.mockImplementation(
    async (params: { onCreate?: (s: unknown) => Promise<void> }) => {
      if (made) await params.onCreate?.(sandbox);
      return sandbox;
    },
  );
}

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a failure");
}

beforeEach(() => {
  vi.clearAllMocks();
  state.configured = true;
  state.audits = [];
  state.strictFails = false;
  state.queries = [];
  state.rateTaken = 0;
});

describe("the Session's Sandbox", () => {
  it("is unavailable, and calls nothing, when Vercel Sandbox is not set up", async () => {
    state.configured = false;
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "ls",
      } as never),
    );
    expect(error).toBeInstanceOf(StateError);
    expect(error.message).toMatch(/^Sandbox unavailable/);
    expect(sdk.getOrCreate).not.toHaveBeenCalled();
    expect(state.rateTaken).toBe(0);
  });

  it("runs a user's command in a named Sandbox with no network, audited before and after", async () => {
    const sandbox = fakeSandbox();
    opens(sandbox, true);
    const run = await sandboxRun({
      ...(actor as object),
      sessionId: SID,
      command: "node -e 'console.log(42)'",
      via: "agent",
    } as never);
    expect(run).toMatchObject({
      exitCode: 0,
      stdout: "42\n",
      timedOut: false,
      truncated: false,
      sandboxCreated: true,
    });
    const params = sdk.getOrCreate.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      name: sessionSandboxName(SID),
      networkPolicy: "deny-all",
      persistent: true,
    });
    // getOrCreate may find one made with another policy: it is set again.
    expect(sandbox.update).toHaveBeenCalledWith({ networkPolicy: "deny-all" });
    const [[command]] = sandbox.runCommand.mock.calls as unknown as [
      [{ cmd: string; args: string[] }],
    ];
    expect(command.cmd).toBe("sh");
    expect(command.args.at(-1)).toBe("node -e 'console.log(42)'");
    expect(state.audits.map((event) => event.action)).toEqual([
      "sandbox.command",
      "sandbox.started",
      "sandbox.command_finished",
    ]);
    expect(state.rateTaken).toBe(1);
  });

  it("does not run a command whose Audit event cannot be written", async () => {
    state.strictFails = true;
    const sandbox = fakeSandbox();
    opens(sandbox, false);
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "ls",
      } as never),
    );
    expect(error).toBeInstanceOf(StateError);
    expect(sandbox.runCommand).not.toHaveBeenCalled();
  });

  it("reports a timeout from `timeout(1)`'s exit code, not as a failure", async () => {
    const sandbox = fakeSandbox({
      runCommand: vi.fn(async () => ({
        exitCode: 124,
        stdout: async () => "",
        stderr: async () => "\nTimed out after 58 s.",
      })),
    });
    opens(sandbox, false);
    const run = await sandboxRun({
      ...(actor as object),
      sessionId: SID,
      command: "sleep 999",
    } as never);
    expect(run.timedOut).toBe(true);
    expect(run.sandboxCreated).toBe(false);
  });

  it("cuts long output and says so", async () => {
    const sandbox = fakeSandbox({
      runCommand: vi.fn(async () => ({
        exitCode: 0,
        stdout: async () => "x".repeat(30_000),
        stderr: async () => "",
      })),
    });
    opens(sandbox, false);
    const run = await sandboxRun({
      ...(actor as object),
      sessionId: SID,
      command: "yes",
    } as never);
    expect(run.stdout).toHaveLength(20_000);
    expect(run.truncated).toBe(true);
  });

  it("hides the SDK's own error and records that the command did not run", async () => {
    sdk.getOrCreate.mockRejectedValue(new Error("401 from api.vercel.com"));
    const error = await failureOf(
      sandboxRun({
        ...(actor as object),
        sessionId: SID,
        command: "ls",
      } as never),
    );
    expect(error.message).toMatch(/^Sandbox unavailable/);
    expect(error.message).not.toContain("vercel.com");
    const finished = state.audits.at(-1);
    expect(finished?.action).toBe("sandbox.command_finished");
    expect(String(finished?.detail?.error)).not.toContain("vercel.com");
  });

  it("writes a file under the workdir and audits its path and size, never its content", async () => {
    const sandbox = fakeSandbox();
    opens(sandbox, false);
    const file = await sandboxWriteFile({
      ...(actor as object),
      sessionId: SID,
      path: "./data/schedule.csv",
      content: "secret-ish,row\n",
    } as never);
    expect(file).toEqual({
      path: "data/schedule.csv",
      bytes: 15,
      directory: false,
      sandboxCreated: false,
    });
    expect(sandbox.writeFiles).toHaveBeenCalledWith([
      {
        path: "/vercel/sandbox/data/schedule.csv",
        content: "secret-ish,row\n",
      },
    ]);
    const written = state.audits.find(
      (event) => event.action === "sandbox.file_written",
    );
    expect(written?.detail).toMatchObject({
      path: "data/schedule.csv",
      bytes: 15,
    });
    expect(JSON.stringify(written)).not.toContain("secret-ish");
  });

  it("refuses a path out of the workdir and a file over the cap, before starting anything", async () => {
    for (const [path, content] of [
      ["../etc/passwd", "x"],
      ["/etc/passwd", "x"],
      ["big.txt", "x".repeat(256 * 1024 + 1)],
    ] as const) {
      const error = await failureOf(
        sandboxWriteFile({
          ...(actor as object),
          sessionId: SID,
          path,
          content,
        } as never),
      );
      expect(error, path).toBeInstanceOf(InvalidError);
    }
    expect(sdk.getOrCreate).not.toHaveBeenCalled();
  });

  it("reads and lists files only in a Sandbox that exists", async () => {
    sdk.get.mockRejectedValueOnce(new Error("not found"));
    expect(
      await failureOf(
        sandboxReadFile({
          ...(actor as object),
          sessionId: SID,
          path: "a.csv",
        } as never),
      ),
    ).toBeInstanceOf(NotFoundError);
    expect(sdk.getOrCreate).not.toHaveBeenCalled();

    const sandbox = fakeSandbox({
      runCommand: vi.fn(async () => ({
        exitCode: 0,
        stdout: async () => "a.csv\t8\ndata/b.csv\t3\n",
        stderr: async () => "",
      })),
    });
    sdk.get.mockResolvedValue(sandbox);
    const read = await sandboxReadFile({
      ...(actor as object),
      sessionId: SID,
      path: "a.csv",
    } as never);
    expect(read).toEqual({
      path: "a.csv",
      content: "a,b\n1,2\n",
      bytes: 8,
      truncated: false,
    });
    const listed = await sandboxListFiles({
      ...(actor as object),
      sessionId: SID,
      path: "data",
    } as never);
    expect(listed).toEqual([
      { path: "data/b.csv", bytes: 3, directory: false },
    ]);
  });
});
