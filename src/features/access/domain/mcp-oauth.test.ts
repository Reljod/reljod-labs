import { describe, expect, it } from "vitest";
import {
  guestAccessOAuth,
  type HostClaims,
  hostGrant,
  readHostClaims,
} from "./guest-access-oauth";
import { CODE_SECONDS, pkceChallenge, statelessOAuth } from "./mcp-oauth";

const SECRET = "test-salt-0123456789-0123456789-01";
const NOW = Date.parse("2026-11-27T00:00:00Z");
const HOST: HostClaims = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "host@example.com",
};
const VERIFIER = "v".repeat(43);
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

const oauth = guestAccessOAuth;

function registered(uris = [CALLBACK]) {
  const result = oauth.registerClient(
    { redirect_uris: uris, client_name: "Claude" },
    SECRET,
    NOW,
  );
  if (!result.ok) throw new Error(result.error_description);
  return result.registration.client_id;
}

function authorizeQuery(clientId: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK,
    response_type: "code",
    code_challenge: pkceChallenge(VERIFIER),
    code_challenge_method: "S256",
    state: "xyz",
    ...extra,
  });
}

/** Consent, then the code the client gets back on its callback. */
function codeFor(clientId: string, grant = hostGrant(HOST, NOW)) {
  const parsed = oauth.parseAuthorizationRequest(
    authorizeQuery(clientId),
    SECRET,
  );
  if (parsed.kind !== "ok") throw new Error(parsed.kind);
  const back = new URL(
    oauth.approvedRedirect(parsed.request, grant, SECRET, NOW),
  );
  expect(back.searchParams.get("state")).toBe("xyz");
  return back.searchParams.get("code") ?? "";
}

const tokenForm = (fields: Record<string, string>) =>
  new URLSearchParams(fields);

describe("the Guest access OAuth server", () => {
  it("trades a code and its PKCE verifier for an access token that acts for the Host", () => {
    const clientId = registered();
    const result = oauth.redeem(
      tokenForm({
        grant_type: "authorization_code",
        client_id: clientId,
        code: codeFor(clientId),
        redirect_uri: CALLBACK,
        code_verifier: VERIFIER,
      }),
      SECRET,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code?.exp).toBe(Math.floor(NOW / 1000) + CODE_SECONDS);
    const tokens = oauth.tokensFor(result.grant, clientId, SECRET, NOW);
    expect(tokens.expires_in).toBe(3600);
    expect(oauth.readAccessToken(tokens.access_token, SECRET, NOW)).toEqual({
      claims: HOST,
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + 3600,
    });
    // An hour later it has expired, and the refresh token mints another.
    expect(
      oauth.readAccessToken(tokens.access_token, SECRET, NOW + 3_600_000),
    ).toBeNull();
    const refreshed = oauth.redeem(
      tokenForm({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      }),
      SECRET,
      NOW + 3_600_000,
    );
    expect(refreshed.ok && refreshed.grant.claims).toEqual(HOST);
  });

  it("refuses a wrong verifier, another client's code, a changed redirect and an expired code", () => {
    const clientId = registered();
    const other = registered(["http://localhost:3000/callback"]);
    const code = codeFor(clientId);
    const base = {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    };
    for (const [form, now] of [
      [{ ...base, code_verifier: "w".repeat(43) }, NOW],
      [{ ...base, client_id: other }, NOW],
      [{ ...base, redirect_uri: "https://claude.ai/other" }, NOW],
      [base, NOW + (CODE_SECONDS + 1) * 1000],
    ] as const) {
      const result = oauth.redeem(tokenForm(form), SECRET, now);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe("invalid_grant");
    }
  });

  it("ends every refresh with the Grant", () => {
    const clientId = registered();
    const grant = hostGrant(HOST, NOW);
    const tokens = oauth.tokensFor(grant, clientId, SECRET, NOW);
    const result = oauth.redeem(
      tokenForm({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      }),
      SECRET,
      grant.until * 1000,
    );
    expect(!result.ok && result.error_description).toMatch(/ended/);
    // The last access token never outlives the Grant either.
    const last = oauth.tokensFor(
      grant,
      clientId,
      SECRET,
      grant.until * 1000 - 60_000,
    );
    expect(last.expires_in).toBe(60);
  });

  it("verifies nothing signed by another server or with another salt", () => {
    const harnessLike = statelessOAuth<HostClaims>(
      { ...oauth.config, prefix: "ga", context: "harness" },
      readHostClaims,
    );
    const token = harnessLike.signAccessToken(
      { claims: HOST, iat: NOW / 1000, exp: NOW / 1000 + 60 },
      SECRET,
    );
    expect(oauth.readAccessToken(token, SECRET, NOW)).toBeNull();
    const ours = oauth.signAccessToken(
      { claims: HOST, iat: NOW / 1000, exp: NOW / 1000 + 60 },
      SECRET,
    );
    expect(oauth.readAccessToken(ours, `${SECRET}x`, NOW)).toBeNull();
    expect(oauth.readAccessToken(ours, SECRET, NOW)?.claims).toEqual(HOST);
    // A client id is not an access token, though both are signed here.
    expect(oauth.readAccessToken(registered(), SECRET, NOW)).toBeNull();
  });

  it("refuses claims that are not a Host's", () => {
    for (const claims of [
      { userId: "not-a-uuid", email: "host@example.com" },
      { userId: HOST.userId },
      null,
    ]) {
      const token = oauth.signAccessToken(
        {
          claims: claims as unknown as HostClaims,
          iat: NOW / 1000,
          exp: NOW / 1000 + 60,
        },
        SECRET,
      );
      expect(oauth.readAccessToken(token, SECRET, NOW)).toBeNull();
    }
  });

  it("shows an unknown client or callback on the page instead of redirecting", () => {
    const clientId = registered();
    expect(
      oauth.parseAuthorizationRequest(authorizeQuery("gac_forged.sig"), SECRET)
        .kind,
    ).toBe("invalid");
    expect(
      oauth.parseAuthorizationRequest(
        authorizeQuery(clientId, { redirect_uri: "https://evil.example/cb" }),
        SECRET,
      ).kind,
    ).toBe("invalid");
  });

  it("sends a bad request back to the client as an OAuth error", () => {
    const clientId = registered();
    for (const [extra, error] of [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge: "short" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ resource: "https://labs.example/api/harness/mcp" }, "invalid_target"],
    ] as const) {
      const parsed = oauth.parseAuthorizationRequest(
        authorizeQuery(clientId, extra),
        SECRET,
      );
      expect(parsed.kind).toBe("error");
      if (parsed.kind !== "error") continue;
      expect(new URL(parsed.redirect).searchParams.get("error")).toBe(error);
    }
    expect(
      oauth.parseAuthorizationRequest(
        authorizeQuery(clientId, {
          resource: "https://labs.example/api/access/mcp",
        }),
        SECRET,
      ).kind,
    ).toBe("ok");
  });

  it("registers https and loopback callbacks only", () => {
    for (const uri of [
      "http://evil.example/cb",
      "https://x.io/#frag",
      "nope",
    ]) {
      const result = oauth.registerClient(
        { redirect_uris: [uri] },
        SECRET,
        NOW,
      );
      expect(!result.ok && result.error).toBe("invalid_redirect_uri");
    }
    // A loopback callback may come back on any port (RFC 8252).
    const clientId = registered(["http://127.0.0.1:3000/callback"]);
    expect(
      oauth.parseAuthorizationRequest(
        authorizeQuery(clientId, {
          redirect_uri: "http://127.0.0.1:51234/callback",
        }),
        SECRET,
      ).kind,
    ).toBe("ok");
  });

  it("names its own issuer and resource, apart from the other servers'", () => {
    const origin = "https://labs.example";
    expect(oauth.protectedResourceMetadata(origin)).toMatchObject({
      resource: "https://labs.example/api/access/mcp",
      authorization_servers: ["https://labs.example/api/access"],
    });
    expect(oauth.authorizationServerMetadata(origin)).toMatchObject({
      issuer: "https://labs.example/api/access",
      authorization_endpoint: "https://labs.example/access/mcp/authorize",
      token_endpoint: "https://labs.example/api/access/oauth/token",
      registration_endpoint: "https://labs.example/api/access/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  });
});
