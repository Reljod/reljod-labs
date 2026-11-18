import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  currentOwner: vi.fn(),
  getThread: vi.fn(),
}));

vi.mock("./session", () => ({ currentOwner: mocks.currentOwner }));
vi.mock("./repository", () => ({ getThread: mocks.getThread }));
vi.mock("./assistant", () => ({}));
vi.mock("./graph-tools", () => ({}));
vi.mock("./service", () => ({ LimitError: class extends Error {} }));

import { gatedThread } from "./threads";

const THREAD = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  mocks.currentOwner.mockReset();
  mocks.getThread.mockReset();
});

describe("gatedThread", () => {
  it("gives the Thread to its Owner", async () => {
    mocks.currentOwner.mockResolvedValue("host:me");
    mocks.getThread.mockResolvedValue({ id: THREAD, owner: "host:me" });
    expect((await gatedThread(THREAD)).thread?.id).toBe(THREAD);
  });

  it("hides another Owner's Thread", async () => {
    mocks.currentOwner.mockResolvedValue("guest:other");
    mocks.getThread.mockResolvedValue({ id: THREAD, owner: "host:me" });
    expect((await gatedThread(THREAD)).thread).toBeNull();
  });

  it("refuses when the gate refuses, though the lookup ran alongside", async () => {
    mocks.currentOwner.mockRejectedValue(new Error("denied"));
    mocks.getThread.mockResolvedValue({ id: THREAD, owner: "host:me" });
    await expect(gatedThread(THREAD)).rejects.toThrow("denied");
  });
});
