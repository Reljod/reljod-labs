import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  audits: [] as { action: string; detail?: Record<string, unknown> }[],
  strictFails: false,
}));

const sandbox = vi.hoisted(() => ({
  writeFiles: vi.fn(async () => {}),
}));

const mocks = vi.hoisted(() => ({
  openSandbox: vi.fn(),
  execIn: vi.fn(),
  removeSandbox: vi.fn(async () => true),
}));

vi.mock("server-only", () => ({}));
vi.mock("../sandbox", () => mocks);
vi.mock("../audit", () => ({
  audit: async (input: { action: string }) => {
    state.audits.push(input);
    return 1;
  },
  auditStrict: async (input: { action: string }) => {
    if (state.strictFails) throw new Error("insert failed");
    state.audits.push(input);
  },
}));

import type { Owner } from "@/features/access/domain/owner";
import { ConflictError } from "@/platform/errors";
import { paperFiles, RUN_CODE_TOOL, stepCode } from "./code";

const scope = {
  owner: "guest:1" as Owner,
  runId: "11111111-1111-4111-8111-111111111111",
  sessionId: null,
  stepId: "read_documents",
};
const papers = [{ title: "Request form", text: "Amount: CI$1,250.00" }];

type Execute = (input: { code: string }) => Promise<string>;
const executeOf = (code: ReturnType<typeof stepCode>) =>
  (code.tools[RUN_CODE_TOOL] as unknown as { execute: Execute }).execute;

beforeEach(() => {
  vi.clearAllMocks();
  state.audits = [];
  state.strictFails = false;
  mocks.openSandbox.mockImplementation(
    async (
      _name: string,
      options: { onCreate?: (s: unknown) => Promise<void> },
    ) => {
      await options.onCreate?.(sandbox);
      return { sandbox, created: true };
    },
  );
  mocks.execIn.mockResolvedValue({
    exitCode: 0,
    stdout: "1250\n",
    stderr: "",
    timedOut: false,
    truncated: false,
    ms: 12,
  });
});

describe("paperFiles", () => {
  it("puts each paper in papers/ with an index of titles", () => {
    const files = paperFiles(papers);
    expect(files.map((file) => file.path)).toEqual([
      "/vercel/sandbox/papers/1.txt",
      "/vercel/sandbox/papers/index.json",
    ]);
    expect(JSON.parse(files[1]?.content ?? "")).toEqual([
      { file: "papers/1.txt", title: "Request form" },
    ]);
  });
});

describe("stepCode", () => {
  it("makes no Sandbox until the model runs code, and removes nothing then", async () => {
    const code = stepCode(scope, papers);
    await code.dispose();
    expect(mocks.openSandbox).not.toHaveBeenCalled();
    expect(mocks.removeSandbox).not.toHaveBeenCalled();
  });

  it("runs the code with node in a Sandbox of its own, with the papers on disk, and removes it", async () => {
    const code = stepCode(scope, papers);
    const answer = await executeOf(code)({ code: "console.log(1250)" });
    expect(answer).toContain("exit 0");
    expect(answer).toContain("1250");
    const [name, options] = mocks.openSandbox.mock.calls[0] ?? [];
    expect(name).toMatch(/^harness-step-/);
    expect(options).toMatchObject({ persistent: false });
    expect(sandbox.writeFiles).toHaveBeenCalledWith(paperFiles(papers));
    expect(mocks.execIn.mock.calls[0]?.[1]).toBe("node step-1.mjs");
    expect(state.audits.map((event) => event.action)).toEqual([
      "sandbox.command",
      "sandbox.command_finished",
    ]);
    await code.dispose();
    expect(mocks.removeSandbox).toHaveBeenCalledWith(name);
  });

  it("holds a Step to its runs and opens one Sandbox for all of them", async () => {
    const code = stepCode(scope, papers);
    const execute = executeOf(code);
    for (let index = 0; index < 3; index += 1) await execute({ code: "1" });
    expect(await execute({ code: "1" })).toMatch(/^No more runs/);
    expect(mocks.execIn).toHaveBeenCalledTimes(3);
    expect(mocks.openSandbox).toHaveBeenCalledTimes(1);
  });

  it("does not run code whose Audit event cannot be written", async () => {
    state.strictFails = true;
    const code = stepCode(scope, papers);
    expect(await executeOf(code)({ code: "1" })).toMatch(/not run/);
    expect(mocks.openSandbox).not.toHaveBeenCalled();
  });

  it("answers the model with a failure instead of throwing, and hides an unknown error", async () => {
    mocks.openSandbox.mockRejectedValueOnce(
      new ConflictError("Sandbox unavailable: it is not set up here"),
    );
    const code = stepCode(scope, papers);
    expect(await executeOf(code)({ code: "1" })).toContain(
      "Sandbox unavailable",
    );
    mocks.execIn.mockRejectedValueOnce(
      new Error("token abc at api.vercel.com"),
    );
    const again = await executeOf(stepCode(scope, papers))({ code: "1" });
    expect(again).toContain("The Sandbox failed.");
    expect(again).not.toContain("vercel.com");
  });
});
