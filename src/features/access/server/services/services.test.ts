import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ForbiddenError,
  LimitError,
  UnauthorizedError,
} from "@/platform/errors";
import { AccessDeniedError } from "../errors";
import type { Access } from "../gate";
import type { AccessPorts, Browser } from "../ports";
import type { GuestPassRow } from "../repository";
import { createDoorService } from "./door";
import { createGuestPassService } from "./guest-passes";
import { createMcpClientService } from "./mcp-clients";
import { createProfileService } from "./profile";

const PASS_ID = "6c1c3a0e-7f7e-4b8e-9d55-0d1d1f0a0b0c";
const visitor = { hash: "v", trusted: false };
const host: Access = {
  kind: "host",
  userId: "4b7f0c1e-0000-4000-8000-000000000001",
  email: "host@example.com",
  name: "",
};
const guest: Access = {
  kind: "guest",
  userId: "4b7f0c1e-0000-4000-8000-000000000002",
  passId: PASS_ID,
  label: "Ana",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

const livePass: GuestPassRow = {
  id: PASS_ID,
  label: "Ana",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  max_devices: 2,
  revoked_at: null,
  renewed_at: null,
  deleted_at: null,
};

/** Fake ports that record, in order, every call that reaches the outside world. */
function fakes(
  over: { codeLooksGood?: boolean; attempt?: number | null } = {},
) {
  const calls: string[] = [];
  const record =
    <T>(name: string, value: T) =>
    async (...args: unknown[]) => {
      calls.push(args.length ? `${name}(${args.join(",")})` : name);
      return value;
    };
  const ports: AccessPorts = {
    door: {
      takeAttempt: record(
        "takeAttempt",
        over.attempt === undefined ? 7 : over.attempt,
      ),
      settleAttempt: record("settleAttempt", undefined),
      releaseAttempt: record("releaseAttempt", undefined),
      codeLooksGood: record("codeLooksGood", over.codeLooksGood ?? true),
      redeem: record("redeem", { passId: PASS_ID, expiresAt: "x" }),
      deleteGuest: record("deleteGuest", undefined),
      endGuestSession: record("endGuestSession", undefined),
    },
    passes: {
      countLive: record("countLive", 0),
      list: record("list", []),
      byId: record("byId", livePass),
      insert: record("insert", livePass),
      revoke: record("revoke", undefined),
      extend: record("extend", undefined),
      replaceCode: record("replaceCode", undefined),
      markDeleted: record("markDeleted", undefined),
      restore: record("restore", undefined),
    },
    passwords: { verify: record("verify", true) },
    analytics: { track: record("track", undefined) },
    tokens: { disconnectAll: record("disconnectAll", undefined) },
    authReady: () => true,
    newGuestCode: () => "ABCD-EFGH-JKMN",
    now: () => new Date(),
  };
  const browser: Browser = {
    claims: record("claims", null),
    signInAnonymously: record("signInAnonymously", "new-guest"),
    signInWithPassword: record("signInWithPassword", true),
    host: record("host", null),
    signOut: record("signOut", undefined),
    setDisplayName: record("setDisplayName", true),
    setPassword: record("setPassword", "changed"),
    hint: record("hint", undefined),
  };
  return { ports, browser, calls };
}

describe("the door", () => {
  it("records a wrong Guest code as a failed try before it answers, and creates no Auth user", async () => {
    const { ports, browser, calls } = fakes({ codeLooksGood: false });
    const door = createDoorService(ports);
    await expect(
      door.redeem(
        browser,
        { access: null, visitor },
        { code: "ABCD-EFGH-JKMN" },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls[0]).toBe("takeAttempt(v,code)");
    expect(calls).not.toContain("settleAttempt(7)");
    expect(calls).not.toContain("releaseAttempt(7)");
    expect(calls).not.toContain("signInAnonymously");
  });

  it("counts a code that cannot be one too, and looks nothing up", async () => {
    const { ports, browser, calls } = fakes();
    await expect(
      createDoorService(ports).redeem(
        browser,
        { access: null, visitor },
        { code: "nope" },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls).toEqual(["takeAttempt(v,code)"]);
  });

  it("refuses a visitor over the cap before the code is looked at", async () => {
    const { ports, browser, calls } = fakes({ attempt: null });
    await expect(
      createDoorService(ports).redeem(
        browser,
        { access: null, visitor },
        { code: "ABCD-EFGH-JKMN" },
      ),
    ).rejects.toBeInstanceOf(LimitError);
    expect(calls).toEqual(["takeAttempt(v,code)"]);
  });

  it("settles the try only once the code redeemed", async () => {
    const { ports, browser, calls } = fakes();
    const answer = await createDoorService(ports).redeem(
      browser,
      { access: null, visitor },
      { code: "abcd efgh jkmn", next: "/demos/casework" },
    );
    expect(answer).toEqual({ to: "/demos/casework" });
    expect(calls.indexOf("takeAttempt(v,code)")).toBe(0);
    expect(calls.indexOf("settleAttempt(7)")).toBeGreaterThan(
      calls.findIndex((call) => call.startsWith("redeem(")),
    );
  });

  it("signs out an account that is not a Host, and leaves the try counted", async () => {
    const { ports, browser, calls } = fakes();
    await expect(
      createDoorService(ports).signIn(browser, visitor, {
        email: "someone@example.com",
        password: "secret",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls[0]).toBe("takeAttempt(v,sign_in)");
    expect(calls).toContain("signOut");
    expect(calls).not.toContain("settleAttempt(7)");
    expect(calls).not.toContain("hint(host)");
  });
});

describe("a Host's services", () => {
  const { ports, browser, calls } = fakes();
  const passes = createGuestPassService(ports);
  const profile = createProfileService(ports);
  const mcp = createMcpClientService(ports);
  const hostOnly: [string, (access: Access | null) => Promise<unknown>][] = [
    ["list", (a) => passes.list(a)],
    ["liveCount", (a) => passes.liveCount(a)],
    ["issue", (a) => passes.issue(a, { label: "Ana", hours: 24, devices: 2 })],
    ["extend", (a) => passes.extend(a, PASS_ID, 24)],
    ["newCode", (a) => passes.newCode(a, PASS_ID)],
    ["revoke", (a) => passes.revoke(a, PASS_ID)],
    ["remove", (a) => passes.remove(a, PASS_ID)],
    ["restore", (a) => passes.restore(a, PASS_ID)],
    ["rename", (a) => profile.rename(a, browser, "Ana")],
    [
      "changePassword",
      (a) =>
        profile.changePassword(a, browser, visitor, {
          current: "old password",
          next: "new password",
          confirm: "new password",
        }),
    ],
    ["disconnectAll", (a) => mcp.disconnectAll(a)],
  ];

  it.each(
    hostOnly,
  )("refuses %s to a Guest, the e2e suite and a visitor, touching nothing", async (_name, call) => {
    for (const who of [guest, { kind: "e2e" } as const, null]) {
      calls.length = 0;
      await expect(call(who)).rejects.toBeInstanceOf(AccessDeniedError);
      expect(calls).toEqual([]);
    }
  });

  it("disconnects only the Host's own MCP clients", async () => {
    calls.length = 0;
    await mcp.disconnectAll(host);
    expect(calls).toEqual([
      "disconnectAll(host:4b7f0c1e-0000-4000-8000-000000000001)",
    ]);
  });

  it("checks the current password, counted like a sign-in, before changing it", async () => {
    const { ports: p, browser: b, calls: c } = fakes();
    p.passwords.verify = async () => {
      c.push("verify");
      return false;
    };
    await expect(
      createProfileService(p).changePassword(host, b, visitor, {
        current: "wrong password",
        next: "new password",
        confirm: "new password",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(c).toEqual(["takeAttempt(v,sign_in)", "verify"]);
  });

  it("replaces a pass's code with the hash of the new one it shows once (which signs out the old devices)", async () => {
    calls.length = 0;
    const change = await passes.newCode(host, PASS_ID);
    const hash = createHash("sha256").update("ABCDEFGHJKMN").digest("hex");
    expect(change.code).toBe("ABCD-EFGH-JKMN");
    expect(calls).toEqual([
      `byId(${PASS_ID})`,
      `replaceCode(${PASS_ID},${hash})`,
    ]);
  });
});
