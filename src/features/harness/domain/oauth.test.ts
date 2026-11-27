import { describe, expect, it } from "vitest";
import { signMcpToken } from "@/features/client-manager/domain/mcp-token";
import {
  readClient as readCmClient,
  registerClient as registerCmClient,
} from "@/features/client-manager/domain/oauth";
import {
  approvedRedirect,
  authorizationServerMetadata,
  type Grant,
  guestTokenProblem,
  type HarnessClaims,
  parseAuthorizationRequest,
  pkceChallenge,
  protectedResourceMetadata,
  readClient,
  readHarnessToken,
  redeem,
  redirectMatches,
  redirectUriAllowed,
  registerClient,
  signHarnessToken,
  tokensFor,
} from "./oauth";

const SECRET = "test-salt";
const NOW = Date.UTC(2026, 10, 17, 12);
const SECONDS = Math.floor(NOW / 1000);
const PASS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const VERIFIER = "v".repeat(43);

const claims = (over: Partial<HarnessClaims> = {}): HarnessClaims => ({
  kind: "guest",
  owner: `guest:${PASS}`,
  staffId: STAFF,
  visitor: "hash",
  via: "pasted",
  user: USER,
  pass: PASS,
  exp: SECONDS + 600,
  ...over,
});

const grant = (over: Partial<Grant> = {}): Grant => ({
  kind: "host",
  owner: `host:${USER}`,
  staffId: STAFF,
  visitor: "hash",
  email: "host@example.test",
  until: SECONDS + 30 * 86_400,
  ...over,
});

function registered(uris = ["https://claude.ai/api/mcp/auth_callback"]) {
  const result = registerClient(
    { client_name: "Claude", redirect_uris: uris },
    SECRET,
    NOW,
  );
  if (!result.ok) throw new Error(result.error_description);
  return result.registration.client_id;
}

function authorize(clientId: string, over: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: pkceChallenge(VERIFIER),
    code_challenge_method: "S256",
    state: "xyz",
    ...over,
  });
}

function codeFor(clientId: string, g = grant()) {
  const parsed = parseAuthorizationRequest(authorize(clientId), SECRET);
  if (parsed.kind !== "ok") throw new Error("bad request");
  const url = new URL(approvedRedirect(parsed.request, g, SECRET, NOW));
  return url.searchParams.get("code") ?? "";
}

describe("Harness MCP token", () => {
  it("round-trips its claims", () => {
    const token = signHarnessToken(
      claims({ sessionId: "s1", via: "chat" }),
      SECRET,
    );
    expect(token.startsWith("hxm_")).toBe(true);
    expect(readHarnessToken(token, SECRET, NOW)).toMatchObject({
      owner: `guest:${PASS}`,
      staffId: STAFF,
      via: "chat",
      sessionId: "s1",
    });
  });

  it("refuses an expired, tampered or wrongly signed token", () => {
    const token = signHarnessToken(claims(), SECRET);
    expect(readHarnessToken(token, SECRET, (SECONDS + 601) * 1000)).toBeNull();
    expect(readHarnessToken(token, "other-salt", NOW)).toBeNull();
    const [payload, signature] = token.slice(4).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims(), staffId: "someone-else" }),
    ).toString("base64url");
    expect(
      readHarnessToken(`hxm_${forged}.${signature}`, SECRET, NOW),
    ).toBeNull();
    expect(readHarnessToken(`hxm_${payload}`, SECRET, NOW)).toBeNull();
    expect(readHarnessToken(42, SECRET, NOW)).toBeNull();
  });

  it("refuses claims without a Staff member, a known via or a real Owner", () => {
    for (const bad of [
      { staffId: "" },
      { via: "magic" as HarnessClaims["via"] },
      { owner: "guest:not-a-uuid" as HarnessClaims["owner"] },
      { kind: "desk" as HarnessClaims["kind"] },
    ]) {
      expect(
        readHarnessToken(signHarnessToken(claims(bad), SECRET), SECRET, NOW),
      ).toBeNull();
    }
  });

  it("never accepts a Client Manager token, even re-prefixed", () => {
    const cm = signMcpToken(
      {
        kind: "host",
        owner: `host:${USER}`,
        visitor: "hash",
        exp: SECONDS + 600,
      },
      SECRET,
    );
    expect(readHarnessToken(cm, SECRET, NOW)).toBeNull();
    expect(readHarnessToken(`hxm_${cm.slice(4)}`, SECRET, NOW)).toBeNull();
  });
});

describe("the guest token rule", () => {
  const oauth = claims({ via: "oauth" });
  const pasted = signHarnessToken(claims(), SECRET);

  it("passes Hosts, chat and pasted tokens without a header", () => {
    expect(guestTokenProblem(claims(), null, SECRET, NOW)).toBeNull();
    expect(
      guestTokenProblem(claims({ via: "chat" }), null, SECRET, NOW),
    ).toBeNull();
    expect(
      guestTokenProblem(
        claims({ kind: "host", via: "oauth" }),
        null,
        SECRET,
        NOW,
      ),
    ).toBeNull();
  });

  it("needs a pasted Harness token for the same pass beside a Guest's OAuth token", () => {
    expect(guestTokenProblem(oauth, null, SECRET, NOW)).toMatch(
      /X-Guest-Token/,
    );
    expect(guestTokenProblem(oauth, pasted, SECRET, NOW)).toBeNull();
    const otherPass = signHarnessToken(
      claims({
        pass: "44444444-4444-4444-8444-444444444444",
        owner: "guest:44444444-4444-4444-8444-444444444444",
      }),
      SECRET,
    );
    expect(guestTokenProblem(oauth, otherPass, SECRET, NOW)).toMatch(
      /not a Harness token/,
    );
    const anotherOauth = signHarnessToken(oauth, SECRET);
    expect(guestTokenProblem(oauth, anotherOauth, SECRET, NOW)).toMatch(
      /not a Harness token/,
    );
  });
});

describe("redirect URIs", () => {
  it("allows https anywhere and http only on loopback", () => {
    expect(redirectUriAllowed("https://claude.ai/cb")).toBe(true);
    expect(redirectUriAllowed("http://localhost:3000/cb")).toBe(true);
    expect(redirectUriAllowed("http://127.0.0.1/cb")).toBe(true);
    expect(redirectUriAllowed("http://evil.example/cb")).toBe(false);
    expect(redirectUriAllowed("https://claude.ai/cb#frag")).toBe(false);
    expect(redirectUriAllowed("https://user:pw@claude.ai/cb")).toBe(false);
    expect(redirectUriAllowed("javascript:alert(1)")).toBe(false);
  });

  it("matches exactly, except any port on loopback", () => {
    const client = {
      name: "c",
      redirectUris: ["http://localhost/cb", "https://a.test/cb"],
    };
    expect(redirectMatches(client, "https://a.test/cb")).toBe(true);
    expect(redirectMatches(client, "https://a.test/cb2")).toBe(false);
    expect(redirectMatches(client, "http://localhost:51234/cb")).toBe(true);
    expect(redirectMatches(client, "http://localhost:51234/other")).toBe(false);
    expect(redirectMatches(client, "https://a.test:8443/cb")).toBe(false);
  });

  it("refuses a registration with a bad redirect URI", () => {
    expect(
      registerClient({ redirect_uris: ["http://evil.example/cb"] }, SECRET, NOW)
        .ok,
    ).toBe(false);
    expect(registerClient({ redirect_uris: [] }, SECRET, NOW).ok).toBe(false);
    expect(registerClient(null, SECRET, NOW).ok).toBe(false);
  });
});

describe("the authorization request", () => {
  it("shows an unknown client or redirect on the page, never redirecting", () => {
    expect(
      parseAuthorizationRequest(authorize("hxc_nope.nope"), SECRET).kind,
    ).toBe("invalid");
    const clientId = registered();
    expect(
      parseAuthorizationRequest(
        authorize(clientId, { redirect_uri: "https://evil.example/cb" }),
        SECRET,
      ).kind,
    ).toBe("invalid");
  });

  it("sends protocol errors back to the client", () => {
    const clientId = registered();
    const cases: Record<string, string>[] = [
      { response_type: "token" },
      { code_challenge: "short" },
      { code_challenge_method: "plain" },
      { resource: "https://site.test/api/client-manager/mcp" },
    ];
    for (const over of cases) {
      const parsed = parseAuthorizationRequest(
        authorize(clientId, over),
        SECRET,
      );
      expect(parsed.kind).toBe("error");
      if (parsed.kind === "error") {
        expect(parsed.redirect).toMatch(
          /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=/,
        );
        expect(parsed.redirect).toContain("state=xyz");
      }
    }
  });

  it("accepts the Harness resource", () => {
    const parsed = parseAuthorizationRequest(
      authorize(registered(), {
        resource: "https://site.test/api/harness/mcp",
      }),
      SECRET,
    );
    expect(parsed.kind).toBe("ok");
  });
});

describe("codes and tokens", () => {
  it("trades a code and the PKCE verifier for a Harness token acting as the chosen Staff member", () => {
    const clientId = registered();
    const result = redeem(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: codeFor(clientId),
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_verifier: VERIFIER,
      }),
      SECRET,
      NOW + 1_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tokens = tokensFor(result.grant, clientId, SECRET, NOW);
    expect(tokens.expires_in).toBe(3600);
    expect(readHarnessToken(tokens.access_token, SECRET, NOW)).toMatchObject({
      via: "oauth",
      staffId: STAFF,
      owner: `host:${USER}`,
    });
  });

  it("refuses a wrong verifier, a wrong redirect, an expired code or another client's code", () => {
    const clientId = registered();
    const code = codeFor(clientId);
    const base = {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_verifier: VERIFIER,
    };
    const tryWith = (over: Record<string, string>, now = NOW) =>
      redeem(new URLSearchParams({ ...base, ...over }), SECRET, now);
    expect(tryWith({ code_verifier: "w".repeat(43) }).ok).toBe(false);
    expect(tryWith({ code_verifier: "short" }).ok).toBe(false);
    expect(tryWith({ redirect_uri: "https://claude.ai/other" }).ok).toBe(false);
    expect(tryWith({}, NOW + 121_000).ok).toBe(false);
    const other = registered([
      "https://claude.ai/api/mcp/auth_callback",
      "https://b.test/cb",
    ]);
    expect(tryWith({ client_id: other }).ok).toBe(false);
  });

  it("refreshes until the Grant ends, never past it", () => {
    const clientId = registered();
    const g = grant({ until: SECONDS + 1_800 });
    const tokens = tokensFor(g, clientId, SECRET, NOW);
    expect(tokens.expires_in).toBe(1_800);
    const refresh = (now: number) =>
      redeem(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        }),
        SECRET,
        now,
      );
    expect(refresh(NOW + 60_000).ok).toBe(true);
    expect(refresh(NOW + 1_801_000).ok).toBe(false);
  });

  it("never crosses with the Client Manager's grants", () => {
    const cm = registerCmClient(
      { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
      SECRET,
      NOW,
    );
    if (!cm.ok) throw new Error("cm registration");
    expect(readClient(cm.registration.client_id, SECRET)).toBeNull();
    expect(
      readClient(`hxc_${cm.registration.client_id.slice(4)}`, SECRET),
    ).toBeNull();
    const harness = registered();
    expect(readCmClient(harness, SECRET)).toBeNull();
    expect(readCmClient(`cmc_${harness.slice(4)}`, SECRET)).toBeNull();
    expect(
      redeem(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: cm.registration.client_id,
        }),
        SECRET,
        NOW,
      ),
    ).toMatchObject({ ok: false, error: "invalid_client" });
  });
});

describe("revocation and single use", () => {
  it("carries the Grant's iat into the access token and through a refresh", () => {
    const clientId = registered();
    const g = grant({ iat: SECONDS - 10 });
    const tokens = tokensFor(g, clientId, SECRET, NOW);
    expect(readHarnessToken(tokens.access_token, SECRET, NOW)?.iat).toBe(
      SECONDS - 10,
    );
    const refreshed = redeem(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      }),
      SECRET,
      NOW,
    );
    expect(refreshed.ok && refreshed.grant.iat).toBe(SECONDS - 10);
    expect(refreshed.ok && refreshed.code).toBeUndefined();
  });

  it("hands back the code it traded, to be recorded as used", () => {
    const clientId = registered();
    const code = codeFor(clientId);
    const result = redeem(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_verifier: VERIFIER,
      }),
      SECRET,
      NOW,
    );
    expect(result.ok && result.code).toEqual({
      value: code,
      exp: SECONDS + 120,
    });
  });

  it("names the callback of a request it would send an error back to", () => {
    const parsed = parseAuthorizationRequest(
      authorize(registered(), { response_type: "token" }),
      SECRET,
    );
    expect(parsed.kind === "error" && parsed.redirectUri).toBe(
      "https://claude.ai/api/mcp/auth_callback",
    );
  });

  it("refuses a token whose iat is not a number", () => {
    const token = signHarnessToken(
      claims({ iat: "soon" as unknown as number }),
      SECRET,
    );
    expect(readHarnessToken(token, SECRET, NOW)).toBeNull();
  });
});

describe("metadata", () => {
  it("names a path-suffixed issuer and the Harness resource", () => {
    const origin = "https://site.test";
    expect(authorizationServerMetadata(origin)).toMatchObject({
      issuer: "https://site.test/api/harness",
      authorization_endpoint: "https://site.test/demos/harness/mcp/authorize",
      token_endpoint: "https://site.test/api/harness/oauth/token",
      registration_endpoint: "https://site.test/api/harness/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
    expect(protectedResourceMetadata(origin)).toMatchObject({
      resource: "https://site.test/api/harness/mcp",
      authorization_servers: ["https://site.test/api/harness"],
    });
  });
});
