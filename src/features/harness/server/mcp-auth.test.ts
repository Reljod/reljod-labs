import { beforeEach, describe, expect, it, vi } from "vitest";
import { type HarnessClaims, signHarnessToken } from "../domain/oauth";

const SECRET = "test-salt-0123456789";
const PASS_A = "11111111-1111-4111-8111-111111111111";
const PASS_B = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  // Staff rows by Owner: one Workspace each.
  staff: {
    "guest:11111111-1111-4111-8111-111111111111": [
      { id: "staff-a", role: "admin" },
    ],
    "guest:22222222-2222-4222-8222-222222222222": [
      { id: "staff-b", role: "admin" },
    ],
  } as Record<string, { id: string; role: string }[]>,
  passes: {} as Record<string, { id: string }>,
  auditFails: false,
  audited: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  env: {
    rateLimitSalt: () => "test-salt-0123456789",
    e2eBypassToken: () => "",
  },
}));
vi.mock("@/features/access/server/env", () => ({
  env: { hostEmails: () => [] },
}));
vi.mock("@/features/access/server/repository", () => ({
  guestPassOf: async (user: string) => {
    const pass = state.passes[user];
    return pass
      ? {
          ...pass,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          revoked_at: null,
          deleted_at: null,
        }
      : null;
  },
}));
vi.mock("./audit", () => ({
  auditStrict: async (input: { action: string }) => {
    if (state.auditFails) throw new Error("audit insert failed");
    state.audited.push(input.action);
  },
}));
vi.mock("./staff", () => ({
  ownedStaff: async (owner: string, id: string) =>
    state.staff[owner]?.find((member) => member.id === id) ?? null,
}));

import { actorOf, mintPastedToken, verifyBearer } from "./mcp-auth";

const exp = () => Math.floor(Date.now() / 1000) + 600;
const guestClaims = (
  pass: string,
  user: string,
  staffId: string,
): HarnessClaims => ({
  kind: "guest",
  owner: `guest:${pass}`,
  staffId,
  visitor: "v",
  via: "pasted",
  user,
  pass,
  exp: exp(),
});

describe("an MCP token reaches only its own Owner's Workspace", () => {
  beforeEach(() => {
    state.passes = { "user-a": { id: PASS_A }, "user-b": { id: PASS_B } };
  });

  it("acts in the Workspace it was minted for", async () => {
    const claims = await verifyBearer(
      signHarnessToken(guestClaims(PASS_A, "user-a", "staff-a"), SECRET),
    );
    expect(claims?.owner).toBe(`guest:${PASS_A}`);
    expect((await actorOf(claims as HarnessClaims))?.staff.id).toBe("staff-a");
  });

  it("refuses a token whose payload was edited to another Owner", async () => {
    const token = signHarnessToken(
      guestClaims(PASS_A, "user-a", "staff-a"),
      SECRET,
    );
    const [payload, signature] = token.slice(4).split(".");
    const forged = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString(),
    );
    forged.owner = `guest:${PASS_B}`;
    forged.pass = PASS_B;
    const edited = `hxm_${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`;
    expect(await verifyBearer(edited)).toBeNull();
  });

  it("refuses a signed token whose Owner is not its Guest pass", async () => {
    const claims = {
      ...guestClaims(PASS_A, "user-a", "staff-a"),
      owner: `guest:${PASS_B}` as const,
    };
    expect(await verifyBearer(signHarnessToken(claims, SECRET))).toBeNull();
  });

  it("refuses a Guest claiming another Guest's pass", async () => {
    // user-a holds PASS_A, but the token names PASS_B.
    expect(
      await verifyBearer(
        signHarnessToken(guestClaims(PASS_B, "user-a", "staff-b"), SECRET),
      ),
    ).toBeNull();
  });

  it("finds no Staff member of another Workspace", async () => {
    const claims = await verifyBearer(
      signHarnessToken(guestClaims(PASS_A, "user-a", "staff-b"), SECRET),
    );
    expect(claims).not.toBeNull();
    expect(await actorOf(claims as HarnessClaims)).toBeNull();
  });

  it("refuses an e2e token when the bypass is not configured, and a token signed elsewhere", async () => {
    const e2e: HarnessClaims = {
      kind: "e2e",
      owner: "e2e",
      staffId: "staff-a",
      visitor: "e2e",
      via: "pasted",
      exp: exp(),
    };
    expect(await verifyBearer(signHarnessToken(e2e, SECRET))).toBeNull();
    expect(
      await verifyBearer(
        signHarnessToken(
          guestClaims(PASS_A, "user-a", "staff-a"),
          "another-secret",
        ),
      ),
    ).toBeNull();
  });
});

describe("a pasted MCP token", () => {
  const context = {
    access: { kind: "e2e" },
    owner: "e2e",
    staff: { id: "staff-a", role: "admin", name: "A" },
    visitor: { hash: "v", trusted: false },
  } as unknown as Parameters<typeof mintPastedToken>[0];

  beforeEach(() => {
    state.auditFails = false;
    state.audited = [];
  });

  it("is handed over only after mcp.connected is written", async () => {
    const minted = await mintPastedToken(context, "https://labs.test");
    expect(minted.token).toMatch(/^hxm_/);
    expect(state.audited).toEqual(["mcp.connected"]);
  });

  it("is not handed over when its Audit event cannot be written", async () => {
    state.auditFails = true;
    await expect(mintPastedToken(context, "https://labs.test")).rejects.toThrow(
      /audit insert failed/,
    );
  });
});
