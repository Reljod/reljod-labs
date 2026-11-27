import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConflictError, ForbiddenError } from "@/platform/errors";
import type { Staff } from "../../domain/staff";
import { createSandboxService } from "./sandbox";

const owner = "host:1" as const;
const visitor = { hash: "v", trusted: false };
const keisha: Staff = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "keisha",
  name: "Keisha",
  title: "",
  role: "user",
  initials: "K",
};
const sessionId = "44444444-4444-4444-8444-444444444444";

function setup(
  options: { strictFails?: boolean; someoneElses?: boolean } = {},
) {
  const calls: string[] = [];
  const service = createSandboxService({
    sandboxes: {
      configured: true,
      write: async () => {
        calls.push("write");
        return { created: false };
      },
      run: async () => {
        calls.push("run");
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          ms: 1,
          sandboxCreated: false,
        };
      },
      read: async () => {
        throw new Error("unused");
      },
      list: async () => [],
    },
    sessions: {
      readable: async () => null,
      writable: async () => {
        if (options.someoneElses)
          throw new ForbiddenError("This Session belongs to Dwayne.");
        return {} as never;
      },
    },
    rate: {
      take: async (kind) => {
        calls.push(`take:${kind}`);
      },
      used: async () => ({}) as never,
    },
    audit: {
      record: async (input) => {
        calls.push(`record:${input.action}`);
        return 1;
      },
      strict: async (input) => {
        if (options.strictFails) throw new Error("insert failed");
        calls.push(`strict:${input.action}`);
      },
    },
  });
  return { service, calls };
}

const actor = { owner, staff: keisha, visitor };

describe("a Sandbox command stands or falls with its Audit event", () => {
  it("is counted and recorded before it runs", async () => {
    const { service, calls } = setup();
    await service.run(actor, { sessionId }, "node -e 1");
    expect(calls).toEqual([
      "take:sandbox_command",
      "strict:sandbox.command",
      "run",
      "record:sandbox.command_finished",
    ]);
  });

  it("does not run when its event cannot be written", async () => {
    const { service, calls } = setup({ strictFails: true });
    await expect(
      service.run(actor, { sessionId }, "node -e 1"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).not.toContain("run");
  });

  it("is refused in someone else's Session before anything is spent", async () => {
    const { service, calls } = setup({ someoneElses: true });
    await expect(
      service.run(actor, { sessionId }, "node -e 1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.write(actor, { sessionId }, "a.txt", "hi"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toEqual([]);
  });
});
