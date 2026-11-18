import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  currentOwner: vi.fn(),
  visitor: vi.fn(),
  catalog: vi.fn(),
  viewableClient: vi.fn(),
  clientSummary: vi.fn(),
  threadsOf: vi.fn(),
  ownedThread: vi.fn(),
  messagesOf: vi.fn(),
}));

vi.mock("./session", () => ({
  currentOwner: mocks.currentOwner,
  visitor: mocks.visitor,
}));
vi.mock("./service", () => ({
  catalog: mocks.catalog,
  viewableClient: mocks.viewableClient,
  clientSummary: mocks.clientSummary,
}));
vi.mock("./threads", () => ({
  threadsOf: mocks.threadsOf,
  ownedThread: mocks.ownedThread,
  messagesOf: mocks.messagesOf,
  summaryOf: (row: { id: string }) => ({ id: row.id }),
}));

import { firstLoad } from "./first-load";

const OWNER = "host:me";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.currentOwner.mockResolvedValue(OWNER);
  mocks.visitor.mockResolvedValue({ hash: "v", trusted: false });
  mocks.catalog.mockResolvedValue([{ id: CLIENT }]);
  mocks.threadsOf.mockResolvedValue([{ id: THREAD }]);
});

describe("firstLoad", () => {
  it("reads nothing when the gate refuses", async () => {
    mocks.currentOwner.mockRejectedValue(new Error("denied"));
    const first = await firstLoad({ clientId: CLIENT, threadId: THREAD });
    expect(first).toEqual({
      initialCatalog: null,
      initialThreads: null,
      initialClient: null,
      initialThread: null,
    });
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.viewableClient).not.toHaveBeenCalled();
  });

  it("scopes every read to the Owner", async () => {
    mocks.viewableClient.mockResolvedValue({ id: CLIENT });
    mocks.clientSummary.mockResolvedValue({ id: CLIENT, nodes: [] });
    mocks.ownedThread.mockResolvedValue({ id: THREAD });
    mocks.messagesOf.mockResolvedValue([]);
    const first = await firstLoad({ clientId: CLIENT, threadId: THREAD });
    expect(mocks.catalog).toHaveBeenCalledWith(OWNER);
    expect(mocks.threadsOf).toHaveBeenCalledWith(OWNER);
    expect(mocks.viewableClient).toHaveBeenCalledWith(CLIENT, OWNER);
    expect(mocks.ownedThread).toHaveBeenCalledWith(THREAD, OWNER);
    expect(first.initialClient).toEqual({ id: CLIENT, nodes: [] });
    expect(first.initialThread).toEqual({
      thread: { id: THREAD },
      messages: [],
    });
  });

  it("leaves out a client or Thread the Owner may not see", async () => {
    mocks.viewableClient.mockResolvedValue(null);
    mocks.ownedThread.mockResolvedValue(null);
    const first = await firstLoad({ clientId: CLIENT, threadId: THREAD });
    expect(first.initialClient).toBeNull();
    expect(first.initialThread).toBeNull();
    expect(mocks.clientSummary).not.toHaveBeenCalled();
    expect(mocks.messagesOf).not.toHaveBeenCalled();
    expect(first.initialCatalog).toEqual([{ id: CLIENT }]);
  });

  it("turns a failed read into null, so the browser asks the route", async () => {
    mocks.catalog.mockRejectedValue(new Error("pool timeout"));
    const first = await firstLoad({ clientId: null, threadId: null });
    expect(first.initialCatalog).toBeNull();
    expect(first.initialThreads).toEqual([{ id: THREAD }]);
    expect(mocks.viewableClient).not.toHaveBeenCalled();
  });
});
