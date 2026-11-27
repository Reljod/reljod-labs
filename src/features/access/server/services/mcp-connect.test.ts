import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvalidError } from "@/platform/errors";
import { guestAccessOAuth } from "../../domain/guest-access-oauth";
import { issuedAfterEpoch } from "../../domain/mcp-clients";
import { pkceChallenge } from "../../domain/mcp-oauth";
import { AccessDeniedError } from "../errors";
import type { Access } from "../gate";
import type { HostAccess } from "../ports";
import { createMcpConnectService, type McpConnectPorts } from "./mcp-connect";

const SECRET = "test-salt-0123456789-0123456789-01";
const NOW = Date.parse("2026-11-27T00:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";
const HOST: HostAccess = {
  kind: "host",
  userId: USER,
  email: "host@example.com",
  name: "",
};
const GUEST: Access = {
  kind: "guest",
  userId: "22222222-2222-4222-8222-222222222222",
  passId: "33333333-3333-4333-8333-333333333333",
  label: "Ana",
  expiresAt: new Date(NOW + 3_600_000).toISOString(),
};
const VERIFIER = "v".repeat(43);
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** The account behind USER as Auth answers now, and the Host's last disconnect. */
function world(
  over: { host?: HostAccess | null; notBefore?: number | null } = {},
) {
  const state = {
    host: over.host === undefined ? HOST : over.host,
    notBefore: over.notBefore ?? null,
    redeemed: new Set<string>(),
    owners: [] as string[],
  };
  const ports: McpConnectPorts = {
    secret: () => SECRET,
    now: () => NOW,
    hostById: async (userId) =>
      state.host && state.host.userId === userId ? state.host : null,
    issuedSinceDisconnect: async (owner, iat) => {
      state.owners.push(owner);
      return issuedAfterEpoch(iat, state.notBefore);
    },
    redeemCodeOnce: async (code) => {
      if (state.redeemed.has(code)) return false;
      state.redeemed.add(code);
      return true;
    },
  };
  return { state, service: createMcpConnectService(ports) };
}

function clientId(callback = CALLBACK) {
  const result = guestAccessOAuth.registerClient(
    { redirect_uris: [callback], client_name: "Claude" },
    SECRET,
    NOW,
  );
  if (!result.ok) throw new Error(result.error_description);
  return result.registration.client_id;
}

function query(id: string, callback = CALLBACK) {
  return new URLSearchParams({
    client_id: id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge: pkceChallenge(VERIFIER),
    code_challenge_method: "S256",
    state: "xyz",
  });
}

function bearer(iat = Math.floor(NOW / 1000), email = "Host@Example.com") {
  return guestAccessOAuth.signAccessToken(
    { claims: { userId: USER, email }, iat, exp: iat + 3600 },
    SECRET,
  );
}

describe("the Guest access consent", () => {
  it("sends anyone but a Host to sign in, never to the client's callback", () => {
    const { service } = world();
    for (const access of [null, GUEST, { kind: "e2e" } as const]) {
      expect(service.review(access, query(clientId()))).toEqual({
        kind: "sign-in",
      });
      expect(() =>
        service.answer(access, {
          request: query(clientId()).toString(),
          answer: "allow",
        }),
      ).toThrow(AccessDeniedError);
    }
  });

  it("asks a Host, and warns about a callback nobody vouched for", () => {
    const { service } = world();
    const callback = "https://unknown.example/cb";
    const review = service.review(HOST, query(clientId(callback), callback));
    expect(review).toMatchObject({
      kind: "ask",
      clientName: "Claude",
      callbackHost: "unknown.example",
      unknownCallback: true,
      email: HOST.email,
    });
    const input = {
      request: query(clientId(callback), callback).toString(),
      answer: "allow" as const,
    };
    expect(() => service.answer(HOST, input)).toThrow(InvalidError);
    expect(
      service.answer(HOST, { ...input, trustHost: "unknown.example" }).to,
    ).toMatch(/^https:\/\/unknown\.example\/cb\?code=/);
  });

  it("sends a Deny back to the client as access_denied", () => {
    const { service } = world();
    const { to } = service.answer(HOST, {
      request: query(clientId()).toString(),
      answer: "deny",
    });
    const back = new URL(to);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.has("code")).toBe(false);
  });
});

describe("the Guest access token endpoint", () => {
  function codeFrom(service: ReturnType<typeof world>["service"], id: string) {
    const { to } = service.answer(HOST, {
      request: query(id).toString(),
      answer: "allow",
    });
    return new URL(to).searchParams.get("code") ?? "";
  }

  const form = (id: string, code: string) =>
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: id,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });

  it("trades a code once for a token that acts for the Host", async () => {
    const { service } = world();
    const id = clientId();
    const code = codeFrom(service, id);
    const first = await service.exchange(form(id, code));
    expect(first.status).toBe(200);
    const token = (first.body as { access_token: string }).access_token;
    expect(await service.verify(token)).toMatchObject({ host: HOST });
    const again = await service.exchange(form(id, code));
    expect(again).toMatchObject({
      status: 400,
      body: { error: "invalid_grant" },
    });
  });

  it("mints nothing once the account is no longer a Host", async () => {
    const { service, state } = world();
    const id = clientId();
    const code = codeFrom(service, id);
    state.host = null;
    expect(await service.exchange(form(id, code))).toMatchObject({
      status: 400,
      body: { error: "invalid_grant" },
    });
  });
});

describe("a Guest access bearer", () => {
  it("acts for the account while it is still a Host with the same email", async () => {
    const { service, state } = world();
    expect(await service.verify(bearer())).toMatchObject({ host: HOST });
    expect(state.owners).toEqual([`host:${USER}`]);
  });

  it("stops when the account is no longer a Host", async () => {
    const { service } = world({ host: null });
    expect(await service.verify(bearer())).toBeNull();
  });

  it("stops when the account's email changed", async () => {
    const { service } = world({
      host: { ...HOST, email: "someone-else@example.com" },
    });
    expect(await service.verify(bearer())).toBeNull();
  });

  it("stops once the Host disconnected their MCP clients", async () => {
    const { service } = world({ notBefore: NOW });
    expect(
      await service.verify(bearer(Math.floor(NOW / 1000) - 60)),
    ).toBeNull();
  });

  it("refuses anything that is not a Guest access token", async () => {
    const { service } = world();
    expect(await service.verify("hxm_abc.def")).toBeNull();
    expect(await service.verify("")).toBeNull();
  });
});
