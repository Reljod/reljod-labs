import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readMcpToken } from "./mcp-token";
import {
  approvedRedirect,
  type Grant,
  parseAuthorizationRequest,
  redeem,
  redirectMatches,
  redirectUriAllowed,
  registerClient,
  tokensFor,
} from "./oauth";

const SECRET = "salt";
const now = Date.UTC(2026, 10, 15);
const seconds = Math.floor(now / 1000);
const callback = "http://localhost:53682/callback";
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const grant: Grant = {
  kind: "host",
  owner: "host:4b7f0c1e-0000-4000-8000-000000000001",
  visitor: "hash",
  email: "host@example.com",
  until: seconds + 30 * 86_400,
};

function register(uris = [callback]) {
  const result = registerClient(
    { client_name: "Claude Code", redirect_uris: uris },
    SECRET,
    now,
  );
  if (!result.ok) throw new Error(result.error_description);
  return result.registration.client_id;
}

function authorize(clientId: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: "https://www.example.com/api/client-manager/mcp",
    ...extra,
  });
}

function codeFor(clientId: string) {
  const parsed = parseAuthorizationRequest(authorize(clientId), SECRET);
  if (parsed.kind !== "ok") throw new Error(parsed.kind);
  const url = new URL(approvedRedirect(parsed.request, grant, SECRET, now));
  expect(url.searchParams.get("state")).toBe("xyz");
  return url.searchParams.get("code") ?? "";
}

describe("redirect URIs", () => {
  it("allows https and loopback http only", () => {
    expect(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback")).toBe(
      true,
    );
    expect(redirectUriAllowed(callback)).toBe(true);
    expect(redirectUriAllowed("http://127.0.0.1:1/cb")).toBe(true);
    expect(redirectUriAllowed("http://evil.example/cb")).toBe(false);
    expect(redirectUriAllowed("javascript:alert(1)")).toBe(false);
    expect(redirectUriAllowed("https://a.example/cb#frag")).toBe(false);
  });

  it("matches exactly, with any port on loopback", () => {
    const client = { name: "x", redirectUris: [callback] };
    expect(redirectMatches(client, callback)).toBe(true);
    expect(redirectMatches(client, "http://localhost:1234/callback")).toBe(
      true,
    );
    expect(redirectMatches(client, "http://localhost:1234/other")).toBe(false);
    const web = { name: "x", redirectUris: ["https://a.example/cb"] };
    expect(redirectMatches(web, "https://a.example/cb2")).toBe(false);
  });
});

describe("registration", () => {
  it("refuses a client without a safe redirect URI", () => {
    expect(registerClient({}, SECRET, now).ok).toBe(false);
    expect(
      registerClient({ redirect_uris: ["http://evil.example/cb"] }, SECRET, now)
        .ok,
    ).toBe(false);
  });
});

describe("the authorization request", () => {
  it("never redirects to an unknown client or URI", () => {
    expect(
      parseAuthorizationRequest(authorize("cmc_forged.sig"), SECRET).kind,
    ).toBe("invalid");
    expect(
      parseAuthorizationRequest(
        authorize(register(), { redirect_uri: "https://evil.example/cb" }),
        SECRET,
      ).kind,
    ).toBe("invalid");
  });

  it("sends other mistakes back to the client", () => {
    const parsed = parseAuthorizationRequest(
      authorize(register(), { code_challenge_method: "plain" }),
      SECRET,
    );
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      const url = new URL(parsed.redirect);
      expect(url.origin + url.pathname).toBe(callback);
      expect(url.searchParams.get("error")).toBe("invalid_request");
      expect(url.searchParams.get("state")).toBe("xyz");
    }
    expect(
      parseAuthorizationRequest(
        authorize(register(), { resource: "https://x.example/other" }),
        SECRET,
      ).kind,
    ).toBe("error");
  });
});

describe("the token endpoint", () => {
  const exchange = (clientId: string, code: string, extra = {}) =>
    redeem(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: callback,
        code_verifier: verifier,
        ...extra,
      }),
      SECRET,
      now,
    );

  it("trades a code and its verifier for an MCP token and a refresh token", () => {
    const clientId = register();
    const result = exchange(clientId, codeFor(clientId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tokens = tokensFor(result.grant, clientId, SECRET, now);
    expect(tokens.expires_in).toBe(3600);
    const claims = readMcpToken(tokens.access_token, SECRET, now);
    expect(claims).toMatchObject({ kind: "host", owner: grant.owner });

    const refreshed = redeem(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      }),
      SECRET,
      now,
    );
    expect(refreshed.ok).toBe(true);
  });

  it("refuses a wrong verifier, another client, or an expired code", () => {
    const clientId = register();
    const code = codeFor(clientId);
    expect(exchange(clientId, code, { code_verifier: "w".repeat(43) }).ok).toBe(
      false,
    );
    expect(exchange(register(["https://a.example/cb"]), code).ok).toBe(false);
    const late = redeem(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: callback,
        code_verifier: verifier,
      }),
      SECRET,
      now + 5 * 60_000,
    );
    expect(late.ok).toBe(false);
  });

  it("never mints past the end of the Grant", () => {
    const short = { ...grant, until: seconds + 60 };
    const tokens = tokensFor(short, register(), SECRET, now);
    expect(tokens.expires_in).toBe(60);
  });
});
