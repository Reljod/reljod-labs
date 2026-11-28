import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LimitError, NotFoundError } from "@/platform/errors";
import { GUEST_ACCESS_TOOLS } from "../domain/guest-access-mcp";
import { registerGuestAccessTools } from "./mcp";
import type { HostAccess } from "./ports";
import type { GuestPassService } from "./services/guest-passes";

type Handler = (
  input: unknown,
  ctx: unknown,
) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const HOST: HostAccess = {
  kind: "host",
  userId: "11111111-1111-4111-8111-111111111111",
  email: "host@example.com",
  name: "",
};
const asHost = { http: { authInfo: { extra: { host: HOST } } } };

/** A Guest pass service that records who called what. */
function fakePasses(over: Partial<GuestPassService> = {}) {
  const calls: unknown[][] = [];
  const passes: GuestPassService = {
    list: async (...args) => {
      calls.push(["list", ...args]);
      return [];
    },
    liveCount: async () => 0,
    issue: async (...args) => {
      calls.push(["issue", ...args]);
      return {
        code: "ABCD-EFGH-JKLM",
        label: "Ada",
        expiresAt: "2026-11-28T00:00:00.000Z",
        devices: 2,
      };
    },
    extend: async () => ({ done: "Extended." }),
    newCode: async () => ({ done: "New code made.", code: "NEWC-ODEX-YZ23" }),
    revoke: async () => ({ done: "Revoked." }),
    remove: async () => ({ done: "Deleted." }),
    restore: async () => ({ done: "Restored." }),
    ...over,
  };
  return { passes, calls };
}

function tools(passes: GuestPassService) {
  const registered = new Map<
    string,
    { config: { annotations: Record<string, unknown> }; handler: Handler }
  >();
  registerGuestAccessTools(
    {
      registerTool: (
        name: string,
        config: { annotations: Record<string, unknown> },
        handler: Handler,
      ) => registered.set(name, { config, handler }),
    } as unknown as McpServer,
    passes,
  );
  return registered;
}

describe("the Guest access MCP tools", () => {
  it("registers every listed tool, marking the ones that end access", () => {
    const registered = tools(fakePasses().passes);
    expect([...registered.keys()]).toEqual(
      GUEST_ACCESS_TOOLS.map((tool) => tool.name),
    );
    expect(
      registered.get("revoke_guest_pass")?.config.annotations.destructiveHint,
    ).toBe(true);
    expect(
      registered.get("list_guest_passes")?.config.annotations.readOnlyHint,
    ).toBe(true);
  });

  it("refuses a call that carries no Host, and reaches no service", async () => {
    const { passes, calls } = fakePasses();
    const result = await tools(passes)
      .get("list_guest_passes")
      ?.handler({}, { http: {} });
    expect(result?.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("issues a pass as the bearer's Host and hands back its code once", async () => {
    const { passes, calls } = fakePasses();
    const input = { label: "Ada", hours: 24, devices: 2 };
    const result = await tools(passes)
      .get("issue_guest_pass")
      ?.handler(input, asHost);
    expect(calls).toEqual([["issue", HOST, input]]);
    expect(result?.isError).toBeUndefined();
    expect(result?.content[0].text).toContain("ABCD-EFGH-JKLM");
  });

  it("answers a service's refusal as a tool error with its message", async () => {
    const { passes } = fakePasses({
      extend: async () => {
        throw new NotFoundError("That pass is gone.");
      },
      issue: async () => {
        throw new LimitError("There are already 20 live Guest passes.");
      },
    });
    const registered = tools(passes);
    expect(
      await registered
        .get("extend_guest_pass")
        ?.handler({ id: "x", hours: 24 }, asHost),
    ).toMatchObject({
      isError: true,
      content: [{ text: "That pass is gone." }],
    });
    expect(
      await registered
        .get("issue_guest_pass")
        ?.handler({ label: "A", hours: 24, devices: 1 }, asHost),
    ).toMatchObject({ isError: true });
  });

  it("hides an unexpected failure's detail", async () => {
    const { passes } = fakePasses({
      revoke: async () => {
        throw new Error("connection string leaked here");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await tools(passes)
      .get("revoke_guest_pass")
      ?.handler({ id: "x" }, asHost);
    spy.mockRestore();
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).not.toContain("connection string");
  });

  it("says a new code is shown once", async () => {
    const result = await tools(fakePasses().passes)
      .get("new_guest_code")
      ?.handler({ id: "x" }, asHost);
    expect(result?.content[0].text).toMatch(/NEWC-ODEX-YZ23.*shown once/);
  });
});
