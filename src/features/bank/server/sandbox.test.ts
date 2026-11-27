import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Teller's Sandbox must not leave snapshots behind: a persistent Sandbox
 * snapshots its whole disk on every stop and keeps it for 30 days, and
 * `delete()` alone keeps a Sandbox's snapshots. No real Sandbox is started
 * here: `@vercel/sandbox` is mocked.
 */

const sandbox = {
  update: vi.fn(async () => {}),
  writeFiles: vi.fn(async () => {}),
  runCommand: vi.fn(async () => ({
    exitCode: 0,
    stdout: async () =>
      'CHART:{"type":"bar","title":"t","labels":["a"],"series":[{"name":"s","values":[1]}]}\n',
    stderr: async () => "",
  })),
  stop: vi.fn(async () => {}),
  delete: vi.fn(async () => {}),
};
const getOrCreate = vi.fn(async (_options: Record<string, unknown>) => sandbox);
const get = vi.fn(async (_options: Record<string, unknown>) => sandbox);

vi.mock("server-only", () => ({}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    getOrCreate: (options: Record<string, unknown>) => getOrCreate(options),
    get: (options: Record<string, unknown>) => get(options),
  },
}));
vi.mock("./db", () => ({ sql: vi.fn() }));
vi.mock("./env", () => ({ env: { sandboxConfigured: () => true } }));
vi.mock("../core/engine", () => ({ runRead: vi.fn() }));

const { chartOf, disposeSandbox, runCode, sandboxName, sdkReason } =
  await import("./sandbox");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the Teller's Sandbox leaves no snapshots behind", () => {
  it("is created not persistent, with no network, and an existing one is set the same", async () => {
    const result = await runCode({
      sessionId: "s1",
      callId: "call-1",
      code: "console.log(1)",
      files: [{ path: "/vercel/sandbox/data/customer.json", content: "{}" }],
    });
    expect(result.exitCode).toBe(0);
    expect(getOrCreate).toHaveBeenCalledTimes(1);
    expect(getOrCreate.mock.calls[0]?.[0]).toMatchObject({
      name: sandboxName("s1"),
      persistent: false,
      networkPolicy: "deny-all",
    });
    // getOrCreate may return a Sandbox made earlier with other settings.
    expect(sandbox.update).toHaveBeenCalledWith({
      networkPolicy: "deny-all",
      persistent: false,
    });
    // Nothing asks for a snapshot, and nothing sets one to never expire.
    expect(getOrCreate.mock.calls[0]?.[0]).not.toHaveProperty(
      "snapshotExpiration",
      0,
    );
  });

  it("is deleted with its snapshots", async () => {
    await disposeSandbox("s1");
    expect(get).toHaveBeenCalledWith({ name: sandboxName("s1") });
    expect(sandbox.delete).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
  });

  it("deletes even when stopping fails, and never throws", async () => {
    sandbox.stop.mockRejectedValueOnce(new Error("already stopped"));
    await expect(disposeSandbox("s1")).resolves.toBeUndefined();
    expect(sandbox.delete).toHaveBeenCalledWith({
      deleteOrphanSnapshots: true,
    });
    get.mockRejectedValueOnce(new Error("not found"));
    await expect(disposeSandbox("gone")).resolves.toBeUndefined();
  });
});

describe("a chart printed by the Sandbox", () => {
  it("is read from its CHART line and held to a safe shape", () => {
    const chart = chartOf(
      'hello\nCHART:{"type":"line","title":"Spending","unit":"MRF","labels":["Sep","Oct"],"series":[{"name":"Out","values":[12.5,"x"]}]}\n',
    );
    expect(chart).toEqual({
      type: "line",
      title: "Spending",
      unit: "MRF",
      labels: ["Sep", "Oct"],
      series: [{ name: "Out", values: [12.5, 0] }],
    });
    expect(chartOf("no chart here")).toBeNull();
    expect(chartOf('CHART:{"type":"pie","labels":[],"series":[]}')).toBeNull();
    expect(chartOf("CHART:{not json")).toBeNull();
  });
});

describe("a Sandbox failure", () => {
  it("reaches the model as a redacted reason, never the raw SDK message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getOrCreate.mockRejectedValueOnce(
      new TypeError(`fetch failed: Bearer abc.def with ${"k".repeat(40)}`),
    );
    const result = await runCode({
      sessionId: "s1",
      callId: "call-2",
      code: "console.log(1)",
      files: [],
    });
    expect(JSON.stringify(result)).not.toContain("Bearer");
    expect(JSON.stringify(result)).not.toContain("k".repeat(40));
    expect(JSON.stringify(result)).toContain("TypeError");
  });

  it("shows Vercel's status, code and message, with anything token-shaped cut", () => {
    const apiError = Object.assign(new Error("Bad Request"), {
      response: { status: 400 },
      json: {
        error: {
          code: "bad_request",
          message: `Invalid cwd for token ${"a".repeat(40)}`,
        },
      },
    });
    expect(sdkReason(apiError)).toBe(
      "HTTP 400 bad_request: Invalid cwd for token [hidden]",
    );
    expect(sdkReason(new TypeError("Bearer abc at api.vercel.com"))).toBe(
      "TypeError",
    );
    expect(sdkReason("nope")).toBe("unknown error");
  });
});
