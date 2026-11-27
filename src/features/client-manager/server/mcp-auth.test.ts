import { beforeEach, describe, expect, it, vi } from "vitest";
import { type McpClaims, signMcpToken } from "../domain/mcp-token";

const HOST = "host:4b7f0c1e-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ notBefore: {} as Record<string, number> }));

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  env: { rateLimitSalt: () => "salt", e2eBypassToken: () => "" },
}));
vi.mock("./session", () => ({ TRUSTED_VISITOR: "trusted", visitor: vi.fn() }));
vi.mock("@/features/access/server/env", () => ({
  env: { hostEmails: () => ["host@example.com"] },
}));
vi.mock("@/features/access/server/gate", () => ({ requireOwner: vi.fn() }));
vi.mock("@/features/access/server/repository", () => ({
  guestPassOf: async () => null,
}));
vi.mock("@/features/access/server/mcp-tokens", async () => {
  const { issuedAfterEpoch } = await import(
    "@/features/access/domain/mcp-clients"
  );
  return {
    issuedSinceDisconnect: async (owner: string, iat: number | undefined) =>
      issuedAfterEpoch(iat, state.notBefore[owner] ?? null),
  };
});

import { deskToken, verifyBearer } from "./mcp-auth";

const now = Math.floor(Date.now() / 1000);
const host = (over: Partial<McpClaims> = {}): McpClaims => ({
  kind: "host",
  owner: HOST,
  visitor: "v",
  email: "host@example.com",
  exp: now + 600,
  ...over,
});

beforeEach(() => {
  state.notBefore = {};
});

describe("Disconnect all MCP clients", () => {
  it("refuses a Host's tokens from before it, with or without iat, and keeps newer ones", async () => {
    const old = signMcpToken(host(), "salt");
    const earlier = signMcpToken(host({ iat: now - 120 }), "salt");
    expect(await verifyBearer(old)).not.toBeNull();
    expect(await verifyBearer(earlier)).not.toBeNull();
    state.notBefore[HOST] = (now - 60) * 1000;
    expect(await verifyBearer(old)).toBeNull();
    expect(await verifyBearer(earlier)).toBeNull();
    expect(
      await verifyBearer(signMcpToken(host({ iat: now }), "salt")),
    ).not.toBeNull();
  });

  it("keeps the app's own chat working after a disconnect: its token carries iat", async () => {
    state.notBefore[HOST] = (now - 60) * 1000;
    const token = deskToken({
      owner: HOST,
      visitor: { hash: "v", trusted: false },
      clientId: null,
    });
    expect(await verifyBearer(token)).not.toBeNull();
  });
});
