import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ configured: true }));
const sdk = vi.hoisted(() => ({ getOrCreate: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { getOrCreate: sdk.getOrCreate },
}));
vi.mock("./env", () => ({
  env: { sandboxConfigured: () => state.configured },
}));

import { runCode } from "./sandbox";

function fakeSandbox() {
  return {
    expiresAt: new Date(Date.now() + 10 * 60_000),
    update: vi.fn(async () => {}),
    extendTimeout: vi.fn(async () => {}),
    writeFiles: vi.fn(async () => {}),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () => "42\n",
      stderr: async () => "",
    })),
    stop: vi.fn(),
    delete: vi.fn(),
    snapshot: vi.fn(),
  };
}

const input = {
  owner: "e2e" as const,
  code: "console.log(42)",
  files: [{ path: "call.json", content: "{}" }],
};

describe("runCode", () => {
  beforeEach(() => {
    state.configured = true;
    sdk.getOrCreate.mockReset();
  });

  it("makes a Sandbox that is not persistent and has no network, so no snapshot is left behind", async () => {
    const sandbox = fakeSandbox();
    sdk.getOrCreate.mockResolvedValue(sandbox);
    const result = await runCode(input);
    expect(result).toMatchObject({ exitCode: 0, stdout: "42\n" });
    expect(sdk.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ persistent: false, networkPolicy: "deny-all" }),
    );
    // No option that would keep a disk around.
    const options = sdk.getOrCreate.mock.calls[0][0];
    expect(options).not.toHaveProperty("snapshotExpiration");
    expect(options).not.toHaveProperty("keepLastSnapshots");
  });

  it("turns persistence off on a Sandbox it found, which keeps its old settings", async () => {
    const sandbox = fakeSandbox();
    sdk.getOrCreate.mockResolvedValue(sandbox);
    await runCode(input);
    expect(sandbox.update).toHaveBeenCalledWith({
      networkPolicy: "deny-all",
      persistent: false,
    });
    // update comes before any file or command touches the Sandbox.
    expect(sandbox.update.mock.invocationCallOrder[0]).toBeLessThan(
      sandbox.writeFiles.mock.invocationCallOrder[0],
    );
  });

  it("never snapshots, stops or deletes: the Sandbox ends by its own short timeout", async () => {
    const sandbox = fakeSandbox();
    sdk.getOrCreate.mockResolvedValue(sandbox);
    await runCode(input);
    expect(sandbox.snapshot).not.toHaveBeenCalled();
    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(sandbox.delete).not.toHaveBeenCalled();
  });

  it("answers Sandbox unavailable without starting one when it cannot be reached", async () => {
    state.configured = false;
    const result = await runCode(input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Sandbox unavailable");
    expect(sdk.getOrCreate).not.toHaveBeenCalled();
  });

  it("returns a failed result, never a throw, when the Sandbox cannot start", async () => {
    sdk.getOrCreate.mockRejectedValue(new Error("quota exhausted"));
    const result = await runCode(input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("quota exhausted");
  });
});
