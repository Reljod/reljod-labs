import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  fork: vi.fn(),
  get: vi.fn(),
  getOrCreate: vi.fn(),
}));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: mocks.create,
    fork: mocks.fork,
    get: mocks.get,
    getOrCreate: mocks.getOrCreate,
  },
}));

vi.mock("./sandbox/screen-bundle.generated", () => ({
  SCREEN_BUNDLE: "// bundle",
  SCREEN_BUNDLE_HASH: "testhash",
}));

import {
  CODE_DISPOSE,
  CODE_OPTIONS,
  disposeCode,
  runCode,
} from "./code-sandbox";
import type { RunContext } from "./context";
import {
  BASE_OPTIONS,
  bootScreen,
  DISPOSE_OPTIONS,
  disposeScreen,
  RUN_OPTIONS,
  ScreenUnavailable,
} from "./screen";

/*
 * A named Vercel Sandbox is persistent by default, and a persistent one
 * writes a snapshot of its whole disk (about 1 GB) each time it stops, kept
 * for 30 days and counted against the team's quota. These tests pin the
 * options that keep the Operator from leaving snapshots behind. No real
 * Sandbox is started.
 */

const finished = (stdout = "", exitCode = 0) => ({
  exitCode,
  stdout: async () => stdout,
  stderr: async () => "",
});

function fakeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    status: "running",
    update: vi.fn(async () => {}),
    writeFiles: vi.fn(async () => {}),
    runCommand: vi.fn(async () => finished('{"ok":true}')),
    stop: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    extendTimeout: vi.fn(async () => {}),
    ...overrides,
  };
}

const ctx = { runId: "run-1", brief: "task", manifest: null } as RunContext;
const boot = () =>
  bootScreen({
    runId: "run-1",
    fixture: {} as never,
    rulebook: {} as never,
    secret: "s",
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.VERCEL_OIDC_TOKEN = "test";
});

describe("the options", () => {
  it("let only the base persist, with one snapshot that expires", () => {
    expect(BASE_OPTIONS.persistent).toBe(true);
    expect(BASE_OPTIONS.keepLastSnapshots).toEqual({ count: 1 });
    // Never 0: that would mean no expiry.
    expect(BASE_OPTIONS.snapshotExpiration).toBeGreaterThan(0);
    expect(BASE_OPTIONS.snapshotExpiration).toBeLessThanOrEqual(
      7 * 24 * 60 * 60_000,
    );
  });

  it("keep a Run's sandboxes from persisting, and ask for their snapshots on delete", () => {
    expect(RUN_OPTIONS).toEqual({
      persistent: false,
      networkPolicy: "deny-all",
    });
    expect(CODE_OPTIONS).toEqual({
      persistent: false,
      networkPolicy: "deny-all",
    });
    expect(DISPOSE_OPTIONS).toEqual({ deleteOrphanSnapshots: true });
    expect(CODE_DISPOSE).toEqual({ deleteOrphanSnapshots: true });
  });
});

describe("the Screen sandbox", () => {
  it("forks the base as a sandbox that does not persist, and says so again after the fork", async () => {
    const run = fakeSandbox();
    mocks.fork.mockResolvedValueOnce(run);
    await boot();
    expect(mocks.fork).toHaveBeenCalledTimes(1);
    expect(mocks.fork.mock.calls[0][0]).toMatchObject({
      sourceSandbox: "operator-screen-base-v1",
      name: "operator-screen-run-1",
      persistent: false,
      networkPolicy: "deny-all",
    });
    expect(run.update).toHaveBeenCalledWith(RUN_OPTIONS);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("builds the base, bounded, when there is none to fork", async () => {
    const base = fakeSandbox();
    const run = fakeSandbox();
    mocks.fork
      .mockRejectedValueOnce(new Error("no source"))
      .mockResolvedValueOnce(run);
    mocks.get.mockRejectedValueOnce(new Error("not found"));
    mocks.create.mockResolvedValueOnce(base);
    await boot();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const made = mocks.create.mock.calls[0][0];
    expect(made).toMatchObject({
      name: "operator-screen-base-v1",
      persistent: true,
      keepLastSnapshots: { count: 1 },
    });
    expect(made.snapshotExpiration).toBeGreaterThan(0);
    // Stopping the persistent base is what writes the one snapshot forks start from.
    expect(base.stop).toHaveBeenCalledTimes(1);
  });

  it("does not assume the base's snapshot exists: a base that cannot be forked is deleted with its snapshots and rebuilt", async () => {
    const stale = fakeSandbox({ status: "stopped" });
    const rebuilt = fakeSandbox();
    const run = fakeSandbox();
    mocks.fork
      .mockRejectedValueOnce(new Error("snapshot_not_found"))
      .mockRejectedValueOnce(new Error("snapshot_not_found"))
      .mockResolvedValueOnce(run);
    // ensureBase sees a stopped base; rebuildBase then fetches it to delete it.
    mocks.get.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale);
    mocks.create.mockResolvedValueOnce(rebuilt);
    await boot();
    // An old base found on the way is first given the bounded settings.
    expect(stale.update).toHaveBeenCalledWith({
      snapshotExpiration: BASE_OPTIONS.snapshotExpiration,
      keepLastSnapshots: { count: 1 },
    });
    expect(stale.delete).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.fork).toHaveBeenCalledTimes(3);
  });

  it("fails clearly when the base cannot be rebuilt", async () => {
    const stale = fakeSandbox({ status: "stopped" });
    mocks.fork.mockRejectedValue(new Error("snapshot_not_found"));
    mocks.get.mockResolvedValue(stale);
    mocks.create.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(boot()).rejects.toBeInstanceOf(ScreenUnavailable);
  });

  it("removes a half-built base with its snapshots", async () => {
    const base = fakeSandbox({
      runCommand: vi.fn(async () => finished("", 1)),
    });
    mocks.fork.mockRejectedValue(new Error("no source"));
    mocks.get.mockRejectedValue(new Error("not found"));
    mocks.create.mockResolvedValue(base);
    await expect(boot()).rejects.toBeInstanceOf(ScreenUnavailable);
    expect(base.delete).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
  }, 20_000);

  it("is deleted with its snapshots when the Run ends", async () => {
    const run = fakeSandbox();
    mocks.get.mockResolvedValueOnce(run);
    await disposeScreen("run-1");
    expect(mocks.get).toHaveBeenCalledWith({ name: "operator-screen-run-1" });
    expect(run.delete).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
  });

  it("is stopped and deleted again, still with its snapshots, when the first delete fails", async () => {
    const run = fakeSandbox({
      delete: vi
        .fn()
        .mockRejectedValueOnce(new Error("busy"))
        .mockResolvedValueOnce(undefined),
    });
    mocks.get.mockResolvedValueOnce(run);
    await disposeScreen("run-1");
    expect(run.stop).toHaveBeenCalledTimes(1);
    expect(run.delete).toHaveBeenCalledTimes(2);
    expect(run.delete).toHaveBeenLastCalledWith({
      deleteOrphanSnapshots: true,
    });
  });
});

describe("the Code sandbox", () => {
  it("is made not to persist, and an existing one is told the same", async () => {
    const sandbox = fakeSandbox({
      runCommand: vi.fn(async () => finished("out")),
    });
    mocks.getOrCreate.mockResolvedValueOnce(sandbox);
    const result = await runCode({
      ctx,
      callId: "c1",
      code: "console.log(1)",
      keyed: [],
    });
    expect(result.exitCode).toBe(0);
    expect(mocks.getOrCreate.mock.calls[0][0]).toMatchObject({
      name: "operator-code-run-1",
      persistent: false,
      networkPolicy: "deny-all",
    });
    expect(sandbox.update).toHaveBeenCalledWith({
      persistent: false,
      networkPolicy: "deny-all",
    });
  });

  it("is deleted with its snapshots when the Run ends", async () => {
    const sandbox = fakeSandbox();
    mocks.get.mockResolvedValueOnce(sandbox);
    await disposeCode("run-1");
    expect(sandbox.delete).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
  });
});
