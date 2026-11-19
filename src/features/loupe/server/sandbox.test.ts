import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getOrCreate: vi.fn(),
  get: vi.fn(),
  snapshotFor: vi.fn(),
  saveSnapshot: vi.fn(),
}));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: mocks.create,
    getOrCreate: mocks.getOrCreate,
    get: mocks.get,
  },
}));
vi.mock("./env", () => ({ env: { sandboxConfigured: () => true } }));
vi.mock("./repository", () => ({
  examinationStatus: async () => "running",
  forgetSnapshot: async () => {},
  isOver: (status: string) => status !== "running" && status !== "queued",
  saveSnapshot: mocks.saveSnapshot,
  snapshotFor: mocks.snapshotFor,
}));

import {
  disposeSandbox,
  ensureSnapshot,
  prepareDocument,
  runCheck,
  SANDBOX_LIMITS,
  SandboxUnavailable,
  sandboxName,
} from "./sandbox";

const ID = "11111111-1111-4111-8111-111111111111";

function fakeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    expiresAt: new Date(Date.now() + 9 * 60_000),
    update: vi.fn(async () => {}),
    extendTimeout: vi.fn(async () => {}),
    writeFiles: vi.fn(async () => {}),
    readFileToBuffer: vi.fn(async () => null),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () => "",
      stderr: async () => "",
    })),
    snapshot: vi.fn(async () => ({ snapshotId: "snap_1" })),
    stop: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// A persistent Sandbox snapshots its whole disk on every stop, kept for a
// month: that is what used up the plan's storage. Nothing here resumes one.
describe("a Loupe Sandbox leaves no snapshots behind", () => {
  it("makes an Examination's Sandbox non-persistent, and enforces it on one that already exists", async () => {
    mocks.snapshotFor.mockResolvedValue("snap_known");
    const sandbox = fakeSandbox();
    mocks.getOrCreate.mockResolvedValue(sandbox);
    await runCheck({
      examinationId: ID,
      document: async () => ({ bytes: Buffer.from("x"), fileName: "a.pdf" }),
      callId: "c-1",
      check: "pdf_structure",
      kind: "payslip",
    });
    expect(mocks.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: sandboxName(ID),
        persistent: false,
        networkPolicy: "deny-all",
      }),
    );
    expect(sandbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ persistent: false }),
    );
  });

  it("deletes a Sandbox together with any snapshots it left", async () => {
    const sandbox = fakeSandbox();
    mocks.get.mockResolvedValue(sandbox);
    await disposeSandbox(ID);
    expect(sandbox.delete).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
  });

  it("builds the packages snapshot in a non-persistent Sandbox, with an expiry in hours", async () => {
    mocks.snapshotFor.mockResolvedValue(null);
    const builder = fakeSandbox();
    mocks.create.mockResolvedValue(builder);
    await expect(ensureSnapshot()).resolves.toBe("snap_1");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ persistent: false }),
    );
    expect(builder.snapshot).toHaveBeenCalledWith({
      expiration: SANDBOX_LIMITS.snapshotMs,
    });
    // 0 would mean never expire.
    expect(SANDBOX_LIMITS.snapshotMs).toBeGreaterThanOrEqual(60 * 60_000);
    expect(SANDBOX_LIMITS.snapshotMs).toBeLessThanOrEqual(48 * 60 * 60_000);
  });

  it("stops and deletes the half-created Sandbox when onCreate fails, and propagates document errors", async () => {
    mocks.snapshotFor.mockResolvedValue("snap_known");
    const sandbox = fakeSandbox();
    mocks.getOrCreate.mockImplementation(
      async (params: { onCreate?: (sbx: typeof sandbox) => Promise<void> }) => {
        await params.onCreate?.(sandbox);
        return sandbox;
      },
    );

    const err = new Error("The Sample's file could not be read.");
    const promise = prepareDocument(ID, async () => {
      throw err;
    });

    await expect(promise).rejects.toThrow(
      "The Sample's file could not be read.",
    );
    await expect(promise).rejects.not.toBeInstanceOf(SandboxUnavailable);
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
    expect(sandbox.delete).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
    expect(mocks.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        onResume: expect.any(Function),
      }),
    );
  });

  it("propagates document errors from runCheck instead of masking them as Sandbox unavailable", async () => {
    mocks.snapshotFor.mockResolvedValue("snap_known");
    const sandbox = fakeSandbox();
    mocks.getOrCreate.mockImplementation(
      async (params: { onCreate?: (sbx: typeof sandbox) => Promise<void> }) => {
        await params.onCreate?.(sandbox);
        return sandbox;
      },
    );

    const out = await runCheck({
      examinationId: ID,
      document: async () => {
        throw new Error("The Upload is gone.");
      },
      callId: "c-2",
      check: "pdf_structure",
      kind: "payslip",
    });
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toBe("The Upload is gone.");
  });
});
