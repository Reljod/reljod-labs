import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrCreate: vi.fn(),
  get: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: { getOrCreate: mocks.getOrCreate, get: mocks.get },
}));
vi.mock("./emit", () => ({ runSink: () => ({ status: mocks.status }) }));
vi.mock("./repository", () => ({
  isOver: (status: string) =>
    status === "completed" || status === "failed" || status === "stopped",
}));

import { RUNNER_SCRIPT, runInSandbox, SANDBOX_LIMITS } from "./sandbox";

function fakeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    expiresAt: new Date(Date.now() + 9 * 60_000),
    update: vi.fn(async () => {}),
    extendTimeout: vi.fn(async () => {}),
    writeFiles: vi.fn(async () => {}),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () => "ok\n",
      stderr: async () => "",
    })),
    stop: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

const input = {
  runId: "11111111-1111-4111-8111-111111111111",
  callId: "call_1",
  code: "console.log('ok')",
  document: async () => ({ id: "d", title: "D", pages: ["one"] }),
  state: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue("running");
});

describe("runInSandbox", () => {
  it("runs the code through the capped runner and keeps node's exit code", async () => {
    const sandbox = fakeSandbox({
      runCommand: vi.fn(async () => ({
        exitCode: 3,
        stdout: async () => "partial",
        stderr: async () => "boom",
      })),
    });
    mocks.getOrCreate.mockResolvedValue(sandbox);
    const result = await runInSandbox(input);
    expect(result).toMatchObject({
      stdout: "partial",
      stderr: "boom",
      exitCode: 3,
    });
    const [command, args] = sandbox.runCommand.mock.calls[0] as unknown as [
      string,
      string[],
    ];
    expect(command).toBe("sh");
    expect(args.slice(0, 3)).toEqual(["-c", RUNNER_SCRIPT, "sieve"]);
    expect(args[3]).toMatch(/\/call_1\.mjs$/);
    expect(sandbox.update).toHaveBeenCalledWith({
      networkPolicy: "deny-all",
      persistent: false,
    });
    expect(sandbox.extendTimeout).not.toHaveBeenCalled();
  });

  it("cuts output in the Sandbox and exits with node's code", () => {
    expect(RUNNER_SCRIPT).toContain(`head -c ${SANDBOX_LIMITS.outputBytes}`);
    expect(RUNNER_SCRIPT).toContain('exit "$code"');
  });

  it("returns an error result, without throwing, when the Sandbox cannot start", async () => {
    mocks.getOrCreate.mockRejectedValue(new Error("quota"));
    const result = await runInSandbox(input);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/could not be started: quota/);
  });

  it("returns an error result when writing the files fails", async () => {
    const sandbox = fakeSandbox({
      writeFiles: vi.fn(async () => {
        throw new Error("disk");
      }),
    });
    mocks.getOrCreate.mockResolvedValue(sandbox);
    const result = await runInSandbox(input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/could not run the code: disk/);
    expect(sandbox.runCommand).not.toHaveBeenCalled();
  });

  it("returns an error result when enforcing the network policy fails", async () => {
    mocks.getOrCreate.mockResolvedValue(
      fakeSandbox({
        update: vi.fn(async () => {
          throw new Error("policy");
        }),
      }),
    );
    const result = await runInSandbox(input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/policy/);
  });

  it("makes no Sandbox for a Run that is already over", async () => {
    mocks.status.mockResolvedValue("stopped");
    const result = await runInSandbox(input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Run is over/);
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it("disposes the Sandbox when the Run was stopped while the code ran", async () => {
    const sandbox = fakeSandbox();
    mocks.getOrCreate.mockResolvedValue(sandbox);
    mocks.get.mockResolvedValue(sandbox);
    mocks.status
      .mockResolvedValueOnce("running")
      .mockResolvedValueOnce("stopped");
    const result = await runInSandbox(input);
    expect(result.exitCode).toBe(0);
    expect(sandbox.stop).toHaveBeenCalled();
    expect(sandbox.delete).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
  });

  it("extends a Sandbox that is about to time out, and survives a refusal", async () => {
    const sandbox = fakeSandbox({
      expiresAt: new Date(Date.now() + 30_000),
      extendTimeout: vi.fn(async () => {
        throw new Error("plan limit");
      }),
    });
    mocks.getOrCreate.mockResolvedValue(sandbox);
    const result = await runInSandbox(input);
    expect(sandbox.extendTimeout).toHaveBeenCalledWith(
      SANDBOX_LIMITS.extendByMs,
    );
    expect(result.exitCode).toBe(0);
  });

  it("writes the pages again when a stopped Sandbox resumes with an empty disk", async () => {
    mocks.getOrCreate.mockResolvedValue(fakeSandbox());
    await runInSandbox(input);
    const options = mocks.getOrCreate.mock.calls[0][0] as {
      onCreate: (box: unknown) => Promise<void>;
      onResume: (box: unknown) => Promise<void>;
    };
    const created = fakeSandbox();
    const resumed = fakeSandbox();
    await options.onCreate(created);
    await options.onResume(resumed);
    expect(created.writeFiles).toHaveBeenCalled();
    expect(resumed.writeFiles.mock.calls).toEqual(
      created.writeFiles.mock.calls,
    );
  });

  it("creates the Sandbox with a short lifetime", async () => {
    mocks.getOrCreate.mockResolvedValue(fakeSandbox());
    await runInSandbox(input);
    expect(mocks.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        networkPolicy: "deny-all",
        timeout: SANDBOX_LIMITS.sandboxMs,
        // A persistent Sandbox snapshots its whole disk on every stop.
        persistent: false,
      }),
    );
    expect(SANDBOX_LIMITS.sandboxMs).toBeLessThanOrEqual(10 * 60_000);
  });
});
