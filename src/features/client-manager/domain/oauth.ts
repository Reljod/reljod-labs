import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { LOOPBACK_HOSTS } from "@/features/access/domain/mcp-clients";
import { type McpClaims, signMcpToken } from "./mcp-token";
import {
  AUTHORIZE_PATH,
  MCP_PATH,
  OAUTH_PATH,
  OAUTH_SCOPE,
} from "./oauth-paths";

/**
 * OAuth 2.1 for the Client Manager MCP server, so an MCP client such as Claude
 * Code connects with the server's URL alone and signs in through the browser.
 *
 * Nothing is stored. A registered client, an authorization code and a refresh
 * token are each signed blobs, like the MCP token itself: the client id
 * carries its redirect URIs, the code carries the PKCE challenge and the
 * Grant, and the refresh token carries the Grant until it ends. The access
 * token is an ordinary MCP token, so the server checks it exactly as before.
 */

export {
  AUTHORIZE_PATH,
  MCP_PATH,
  OAUTH_PATH,
  OAUTH_SCOPE,
  PROTECTED_RESOURCE_PATH,
} from "./oauth-paths";

/** An access token lives an hour; the client refreshes it until the Grant ends. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** Long enough for a redirect and a token request, short enough not to matter if seen. */
export const CODE_SECONDS = 2 * 60;

/**
 * What a person allowed on the consent page: the MCP claims every access
 * token is minted from, and when the whole Grant ends (a Host's after 30
 * days, a Guest's with their Guest pass).
 */
export type Grant = Omit<McpClaims, "exp" | "client"> & { until: number };

export type OAuthError = {
  error:
    | "invalid_request"
    | "invalid_client"
    | "invalid_grant"
    | "unsupported_grant_type"
    | "unsupported_response_type"
    | "invalid_target"
    | "invalid_redirect_uri"
    | "invalid_client_metadata"
    | "access_denied";
  error_description: string;
};

const fail = (
  error: OAuthError["error"],
  description: string,
): { ok: false } & OAuthError => ({
  ok: false,
  error,
  error_description: description,
});

// --- Signed blobs -----------------------------------------------------------

const PREFIX = { client: "cmc_", code: "cmo_", refresh: "cmr_" } as const;
type Kind = keyof typeof PREFIX;

const mac = (kind: Kind, payload: string, secret: string) =>
  createHmac("sha256", `client-manager-oauth:${kind}:${secret}`)
    .update(payload)
    .digest("base64url");

function seal(kind: Kind, value: unknown, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${PREFIX[kind]}${payload}.${mac(kind, payload, secret)}`;
}

function unseal<T>(kind: Kind, token: unknown, secret: string): T | null {
  if (typeof token !== "string" || !token.startsWith(PREFIX[kind])) return null;
  // Strict: a token with extra parts is refused, so `code.x` is not a
  // second spelling of the same code (single use hashes the raw string).
  const [payload, signature, ...rest] = token
    .slice(PREFIX[kind].length)
    .split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(mac(kind, payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

// --- Clients (RFC 7591 dynamic registration) ---------------------------------

export type OAuthClient = { name: string; redirectUris: string[] };

const LOOPBACK = LOOPBACK_HOSTS;

/**
 * https anywhere, or http on this machine (a CLI's local callback). Anyone may register any https callback and any name, so the consent
 * page warns and asks for an explicit "I trust <host>" unless the callback
 * is loopback or a known client's (`callbackTrust` in
 * `access/domain/mcp-clients.ts`).
 */
export function redirectUriAllowed(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

/** Registers a public client: the id it gets back is its own registration. */
export function registerClient(body: unknown, secret: string, now: number) {
  const metadata = (body ?? {}) as Record<string, unknown>;
  const uris = metadata.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > 10 ||
    !uris.every((uri) => typeof uri === "string" && uri.length <= 512)
  ) {
    return fail("invalid_redirect_uri", "Give one to ten redirect_uris.");
  }
  const bad = (uris as string[]).find((uri) => !redirectUriAllowed(uri));
  if (bad) {
    return fail(
      "invalid_redirect_uri",
      `${bad} is not allowed: use https, or http on localhost.`,
    );
  }
  const grantTypes = metadata.grant_types;
  if (Array.isArray(grantTypes) && !grantTypes.includes("authorization_code")) {
    return fail(
      "invalid_client_metadata",
      "Only the authorization_code grant is offered.",
    );
  }
  const name =
    typeof metadata.client_name === "string" && metadata.client_name.trim()
      ? metadata.client_name.trim().slice(0, 80)
      : "An MCP client";
  const client: OAuthClient = { name, redirectUris: uris as string[] };
  return {
    ok: true as const,
    registration: {
      client_id: seal("client", client, secret),
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPE,
    },
  };
}

export function readClient(clientId: unknown, secret: string) {
  const client = unseal<OAuthClient>("client", clientId, secret);
  if (
    !client ||
    typeof client.name !== "string" ||
    !Array.isArray(client.redirectUris)
  )
    return null;
  return client;
}

/** Exact match, except a loopback URI may use any port (RFC 8252 7.3). */
export function redirectMatches(client: OAuthClient, uri: string) {
  if (client.redirectUris.includes(uri)) return true;
  let given: URL;
  try {
    given = new URL(uri);
  } catch {
    return false;
  }
  if (given.protocol !== "http:" || !LOOPBACK.has(given.hostname)) return false;
  return client.redirectUris.some((registered) => {
    const url = new URL(registered);
    url.port = given.port;
    return url.href === given.href;
  });
}

// --- The authorization request ------------------------------------------------

export type AuthorizationRequest = {
  clientId: string;
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
};

/**
 * Reads `/authorize`'s query. An unknown client or redirect URI is shown on
 * the page and never redirected to; anything else wrong goes back to the
 * client as an OAuth error.
 */
export function parseAuthorizationRequest(
  params: URLSearchParams,
  secret: string,
):
  | { kind: "ok"; request: AuthorizationRequest }
  | { kind: "invalid"; message: string }
  | { kind: "error"; redirect: string; redirectUri: string } {
  const clientId = params.get("client_id");
  const client = readClient(clientId, secret);
  if (!clientId || !client)
    return {
      kind: "invalid",
      message:
        "This sign-in link names an app this site does not know. Start again from the app.",
    };
  const given = params.get("redirect_uri");
  const redirectUri =
    given ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !redirectMatches(client, redirectUri))
    return {
      kind: "invalid",
      message:
        "This sign-in link would send you somewhere the app did not register. Start again from the app.",
    };
  const state = params.get("state");
  const back = (error: OAuthError["error"], description: string) => ({
    kind: "error" as const,
    redirect: errorRedirect(redirectUri, state, error, description),
    redirectUri,
  });
  if (params.get("response_type") !== "code")
    return back("unsupported_response_type", "Only response_type=code.");
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))
    return back("invalid_request", "A PKCE code_challenge is required.");
  if (params.get("code_challenge_method") !== "S256")
    return back("invalid_request", "code_challenge_method must be S256.");
  const resource = params.get("resource");
  if (resource && !isMcpResource(resource))
    return back("invalid_target", `This server only grants ${MCP_PATH}.`);
  return {
    kind: "ok",
    request: { clientId, client, redirectUri, state, codeChallenge },
  };
}

/** The Client Manager MCP server on any origin this site answers on. */
function isMcpResource(resource: string) {
  try {
    return new URL(resource).pathname.replace(/\/$/, "") === MCP_PATH;
  } catch {
    return false;
  }
}

export function errorRedirect(
  redirectUri: string,
  state: string | null,
  error: OAuthError["error"],
  description: string,
) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state !== null) url.searchParams.set("state", state);
  return url.href;
}

// --- Codes and tokens -----------------------------------------------------------

type Code = {
  client: string;
  redirectUri: string;
  challenge: string;
  grant: Grant;
  exp: number;
};

/** Where the consent page sends the person once they allow. */
export function approvedRedirect(
  request: AuthorizationRequest,
  grant: Grant,
  secret: string,
  now: number,
) {
  const code: Code = {
    client: sha256(request.clientId),
    redirectUri: request.redirectUri,
    challenge: request.codeChallenge,
    grant,
    exp: Math.floor(now / 1000) + CODE_SECONDS,
  };
  const url = new URL(request.redirectUri);
  url.searchParams.set("code", seal("code", code, secret));
  if (request.state !== null) url.searchParams.set("state", request.state);
  return url.href;
}

type Refresh = { client: string; grant: Grant };

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

/** A fresh access token from the Grant, and a refresh token for the rest of it. */
export function tokensFor(
  grant: Grant,
  clientId: string,
  secret: string,
  now: number,
): TokenResponse {
  const seconds = Math.floor(now / 1000);
  const exp = Math.min(seconds + ACCESS_TOKEN_SECONDS, grant.until);
  const { until: _until, ...claims } = grant;
  const refresh: Refresh = { client: sha256(clientId), grant };
  return {
    access_token: signMcpToken({ ...claims, via: "oauth", exp }, secret),
    token_type: "Bearer",
    expires_in: exp - seconds,
    refresh_token: seal("refresh", refresh, secret),
    scope: OAUTH_SCOPE,
  };
}

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * The token endpoint's grants. Returns the Grant to mint from; the caller
 * checks the holder still has Access before minting.
 */
export function redeem(
  form: URLSearchParams,
  secret: string,
  now: number,
):
  | {
      ok: true;
      grant: Grant;
      clientId: string;
      /** The code traded, to be recorded as used (`redeemCodeOnce`). */
      code?: { value: string; exp: number };
    }
  | ({ ok: false } & OAuthError) {
  const clientId = form.get("client_id");
  if (!clientId || !readClient(clientId, secret))
    return fail("invalid_client", "Unknown client_id. Register again.");
  const seconds = Math.floor(now / 1000);
  switch (form.get("grant_type")) {
    case "authorization_code": {
      const given = form.get("code");
      const code = unseal<Code>("code", given, secret);
      if (!code || code.exp <= seconds || code.client !== sha256(clientId))
        return fail("invalid_grant", "The code is unknown or has expired.");
      if (form.get("redirect_uri") !== code.redirectUri)
        return fail("invalid_grant", "redirect_uri does not match.");
      const verifier = form.get("code_verifier");
      if (
        !verifier ||
        !PKCE_VERIFIER.test(verifier) ||
        sha256(verifier) !== code.challenge
      )
        return fail("invalid_grant", "The PKCE code_verifier does not match.");
      if (code.grant.until <= seconds)
        return fail("invalid_grant", "This access has ended. Sign in again.");
      return {
        ok: true,
        grant: code.grant,
        clientId,
        code: { value: given as string, exp: code.exp },
      };
    }
    case "refresh_token": {
      const refresh = unseal<Refresh>(
        "refresh",
        form.get("refresh_token"),
        secret,
      );
      if (!refresh || refresh.client !== sha256(clientId))
        return fail("invalid_grant", "The refresh token is unknown.");
      if (refresh.grant.until <= seconds)
        return fail("invalid_grant", "This access has ended. Sign in again.");
      return { ok: true, grant: refresh.grant, clientId };
    }
    default:
      return fail(
        "unsupported_grant_type",
        "Use authorization_code or refresh_token.",
      );
  }
}

// --- Metadata ---------------------------------------------------------------------

/** RFC 8414. The issuer is the site itself. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${OAUTH_PATH}/token`,
    registration_endpoint: `${origin}${OAUTH_PATH}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
  };
}

/** RFC 9728, for the MCP server. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Client Manager",
  };
}
