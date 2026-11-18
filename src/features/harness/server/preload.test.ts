import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffContext } from "./context";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
const fail = new Set<string>();
const read =
  <T>(name: string, value: T) =>
  async () => {
    calls.push(name);
    if (fail.has(name)) throw new Error(`${name} failed`);
    return value;
  };

vi.mock("./sessions", () => ({
  listSessions: vi.fn(read("sessions", [{ id: "s1" }])),
  readableSession: vi.fn(async (_context: unknown, id: string) => {
    calls.push("session");
    return id === "s1" ? { id: "s1" } : null;
  }),
  listMessages: vi.fn(read("messages", [{ id: "m1" }])),
}));
vi.mock("./runs", () => ({ listRuns: vi.fn(read("runs", [])) }));
vi.mock("./rules", () => ({ listRules: vi.fn(read("rules", [])) }));
vi.mock("./skills", () => ({ listSkills: vi.fn(read("skills", [])) }));
vi.mock("./knowledge", () => ({
  listSources: vi.fn(read("sources", [])),
  listConflicts: vi.fn(read("conflicts", [])),
}));

const { preloadFirstView } = await import("./preload");

const context = {
  owner: "e2e",
  staff: { id: "staff-1", role: "user" },
} as unknown as StaffContext;

beforeEach(() => {
  calls.length = 0;
  fail.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("preloadFirstView", () => {
  it("reads Chat's lists and the address's tab's, and the open Session's messages", async () => {
    const view = await preloadFirstView(context, {
      tab: "skills",
      params: { session: "s1" },
    });
    expect(Object.keys(view).sort()).toEqual([
      "messages",
      "rules",
      "runs",
      "sessions",
      "skills",
    ]);
    expect(view.messages).toEqual({
      sessionId: "s1",
      messages: [{ id: "m1" }],
    });
  });

  it("starts every read before any of them answers", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { listRuns } = await import("./runs");
    vi.mocked(listRuns).mockImplementationOnce(async () => {
      calls.push("runs");
      await held;
      return [];
    });
    const done = preloadFirstView(context, {
      tab: "chat",
      params: { session: "s1" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The Runs read has not answered, and every other read has started.
    expect([...calls].sort()).toEqual([
      "messages",
      "runs",
      "session",
      "sessions",
    ]);
    release();
    expect((await done).runs).toEqual([]);
  });

  it("leaves out a read that failed, for the tab to read itself", async () => {
    fail.add("runs");
    const view = await preloadFirstView(context, { tab: "chat", params: {} });
    expect(view.runs).toBeUndefined();
    expect(view.sessions).toEqual([{ id: "s1" }]);
  });

  it("does not hand over messages of a Session the Staff member may not read", async () => {
    const view = await preloadFirstView(context, {
      tab: "chat",
      params: { session: "someone-else" },
    });
    expect(view.messages).toBeUndefined();
  });
});
