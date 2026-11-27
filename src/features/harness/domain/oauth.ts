import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { LOOPBACK_HOSTS } from "@/features/access/domain/mcp-clients";
import { type Owner, parseOwner } from "@/features/access/domain/owner";
import {
  HARNESS_AUTHORIZE_PATH,
  HARNESS_ISSUER_PATH,
  HARNESS_MCP_PATH,
  HARNESS_OAUTH_PATH,
  HARNESS_OAUTH_SCOPE,
} from "./mcp-tools";

/*
 * The Harness MCP token and the Harness's own OAuth 2.1 (ADR 0012's design,
 * ADR 0013's endpoints). Nothing is stored: the token, a registered client,
 * an authorization code and a refresh token are each signed blobs.
 *
 * Every blob is signed under a `harness-…` context and carries an `hx…`
 * prefix, so nothing the Client Manager signs with the same salt (its MCP
 * token, its client ids, codes or refresh tokens) can ever verify here, and
 * nothing signed here verifies there.
 */

// --- The MCP token ---------------------------------------------------------------

/** How the token was got: minted per chat turn, by OAuth, or pasted from the Connect page. */
export type TokenVia = "chat" | "oauth" | "pasted";

/**
 * Who an MCP request acts as: the Owner whose Workspace it reaches, the Staff
 * member it acts as (fixed when it is minted, ADR 0013), the visitor hash its
 * limits count against, and what the Access check needs again on each call.
 */
export type HarnessClaims = {
  /** The kind of Access it was minted from. */
  kind: "host" | "guest" | "e2e";
  owner: Owner;
  staffId: string;
  /** The rate-limit identity it spends against. */
  visitor: string;
  via: TokenVia;
  /** A chat token's Session: its Sandbox, and where its Runs are filed. */
  sessionId?: string;
  /** A Guest's anonymous Auth user and Guest pass. */
  user?: string;
  pass?: string;
  /** A Host's account. */
  email?: string;
  /**
   * When the access it carries was given, epoch seconds: a pasted or chat
   * token's mint time, an OAuth token's consent time. Checked against the
   * Owner's token epoch ("Disconnect all MCP clients"). Absent on tokens
   * minted before it existed.
   */
  iat?: number;
  /** Expiry, epoch seconds. */
  exp: number;
};

const TOKEN_PREFIX = "hxm_";
const VIAS: TokenVia[] = ["chat", "oauth", "pasted"];
const KINDS: HarnessClaims["kind"][] = ["host", "guest", "e2e"];

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

const hmac = (context: string, payload: string, secret: string) =>
  createHmac("sha256", `${context}:${secret}`)
    .update(payload)
    .digest("base64url");

function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sealWith(
  prefix: string,
  context: string,
  value: unknown,
  secret: string,
) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${prefix}${payload}.${hmac(context, payload, secret)}`;
}

function unsealWith(
  prefix: string,
  context: string,
  token: unknown,
  secret: string,
): unknown {
  if (typeof token !== "string" || !token.startsWith(prefix)) return null;
  const [payload, signature, ...rest] = token.slice(prefix.length).split(".");
  if (!payload || !signature || rest.length > 0) return null;
  if (!sameText(hmac(context, payload, secret), signature)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function signHarnessToken(claims: HarnessClaims, secret: string) {
  return sealWith(TOKEN_PREFIX, "harness-mcp", claims, secret);
}

const optionalText = (value: unknown) =>
  value === undefined || typeof value === "string";

/** The claims of a Harness token signed here and not expired, else null. */
export function readHarnessToken(
  token: unknown,
  secret: string,
  now = Date.now(),
): HarnessClaims | null {
  const claims = unsealWith(
    TOKEN_PREFIX,
    "harness-mcp",
    token,
    secret,
  ) as Partial<HarnessClaims> | null;
  if (!claims || typeof claims !== "object") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (claims.iat !== undefined && typeof claims.iat !== "number") return null;
  if (!parseOwner(claims.owner)) return null;
  if (typeof claims.staffId !== "string" || !claims.staffId) return null;
  if (typeof claims.visitor !== "string") return null;
  if (!claims.via || !VIAS.includes(claims.via)) return null;
  if (!claims.kind || !KINDS.includes(claims.kind)) return null;
  if (
    !optionalText(claims.sessionId) ||
    !optionalText(claims.user) ||
    !optionalText(claims.pass) ||
    !optionalText(claims.email)
  )
    return null;
  return claims as HarnessClaims;
}

/**
 * ADR 0012's rule for Guests: an OAuth access token of a Guest must travel
 * with a pasted Harness token for the same Guest pass in `X-Guest-Token`.
 * Returns why a request falls short, or null. Hosts, chat tokens and pasted
 * tokens pass.
 */
export function guestTokenProblem(
  claims: HarnessClaims,
  header: string | null,
  secret: string,
  now = Date.now(),
): string | null {
  if (claims.kind !== "guest" || claims.via !== "oauth") return null;
  if (!header)
    return "Guests also send their Harness token in the X-Guest-Token header. Get it on the Harness's Connect page.";
  const key = readHarnessToken(header, secret, now);
  if (
    !key ||
    key.kind !== "guest" ||
    key.via !== "pasted" ||
    key.pass !== claims.pass ||
    key.owner !== claims.owner
  )
    return "X-Guest-Token is not a Harness token for this guest pass. Get a new one on the Harness's Connect page.";
  return null;
}

// --- OAuth -------------------------------------------------------------------------

/** An access token lives an hour; the client refreshes it until the Grant ends. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** Long enough for a redirect and a token request. */
export const CODE_SECONDS = 2 * 60;

/**
 * What a person allowed on the consent page: the claims every access token is
 * minted from (the Staff member they chose included) and when the Grant ends.
 */
export type Grant = Omit<HarnessClaims, "exp" | "via" | "sessionId"> & {
  until: number;
};

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_target"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "access_denied";

export type OAuthError = { error: OAuthErrorCode; error_description: string };

const fail = (
  error: OAuthErrorCode,
  description: string,
): { ok: false } & OAuthError => ({
  ok: false,
  error,
  error_description: description,
});

const BLOB_PREFIX = { client: "hxc_", code: "hxo_", refresh: "hxr_" } as const;
type BlobKind = keyof typeof BLOB_PREFIX;

const seal = (kind: BlobKind, value: unknown, secret: string) =>
  sealWith(BLOB_PREFIX[kind], `harness-oauth:${kind}`, value, secret);

const unseal = <T>(kind: BlobKind, token: unknown, secret: string) =>
  unsealWith(
    BLOB_PREFIX[kind],
    `harness-oauth:${kind}`,
    token,
    secret,
  ) as T | null;

// Clients (RFC 7591) ------------------------------------------------------------------

export type OAuthClient = { name: string; redirectUris: string[] };

const LOOPBACK = LOOPBACK_HOSTS;

/**
 * https anywhere, or http on this machine (a CLI's local callback, RFC 8252). Anyone may register any https callback and any name, so the consent
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

/** Registers a public client: the id it gets back is its own signed registration. */
export function registerClient(body: unknown, secret: string, now: number) {
  const metadata = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
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
      scope: HARNESS_OAUTH_SCOPE,
    },
  };
}

export function readClient(clientId: unknown, secret: string) {
  const client = unseal<OAuthClient>("client", clientId, secret);
  if (
    !client ||
    typeof client.name !== "string" ||
    !Array.isArray(client.redirectUris) ||
    !client.redirectUris.every((uri) => typeof uri === "string")
  )
    return null;
  return client;
}

/** Exact match, except a loopback URI may use any port (RFC 8252 §7.3). */
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
    let url: URL;
    try {
      url = new URL(registered);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) return false;
    url.port = given.port;
    return url.href === given.href;
  });
}

// The authorization request --------------------------------------------------------

export type AuthorizationRequest = {
  clientId: string;
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
};

export function errorRedirect(
  redirectUri: string,
  state: string | null,
  error: OAuthErrorCode,
  description: string,
) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state !== null) url.searchParams.set("state", state);
  return url.href;
}

/** The Harness MCP server on any origin this site answers on. */
function isHarnessResource(resource: string) {
  try {
    return new URL(resource).pathname.replace(/\/$/, "") === HARNESS_MCP_PATH;
  } catch {
    return false;
  }
}

/**
 * Reads the consent page's query. An unknown client or redirect URI is shown
 * on the page and never redirected to; anything else wrong goes back to the
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
        "This sign-in link names an app the Harness does not know. Start again from the app.",
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
  const back = (error: OAuthErrorCode, description: string) => ({
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
  if (resource && !isHarnessResource(resource))
    return back(
      "invalid_target",
      `This server only grants ${HARNESS_MCP_PATH}.`,
    );
  return {
    kind: "ok",
    request: { clientId, client, redirectUri, state, codeChallenge },
  };
}

// Codes and tokens ---------------------------------------------------------------------

type Code = {
  client: string;
  redirectUri: string;
  challenge: string;
  grant: Grant;
  exp: number;
};

type Refresh = { client: string; grant: Grant };

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

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

/** A fresh access token from the Grant (`via: "oauth"`), and a refresh token for the rest of it. */
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
    access_token: signHarnessToken({ ...claims, via: "oauth", exp }, secret),
    token_type: "Bearer",
    expires_in: exp - seconds,
    refresh_token: seal("refresh", refresh, secret),
    scope: HARNESS_OAUTH_SCOPE,
  };
}

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** The S256 challenge of a PKCE verifier. */
export const pkceChallenge = (verifier: string) => sha256(verifier);

/**
 * The token endpoint's two grants. Returns the Grant to mint from; the caller
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
        pkceChallenge(verifier) !== code.challenge
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

// Metadata ----------------------------------------------------------------------------

/** The Harness's issuer: path-suffixed, so it is not the Client Manager's (the bare origin). */
export const issuerOf = (origin: string) => `${origin}${HARNESS_ISSUER_PATH}`;

/** RFC 8414, served at `/.well-known/oauth-authorization-server/api/harness`. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: issuerOf(origin),
    authorization_endpoint: `${origin}${HARNESS_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${HARNESS_OAUTH_PATH}/token`,
    registration_endpoint: `${origin}${HARNESS_OAUTH_PATH}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [HARNESS_OAUTH_SCOPE],
  };
}

/** RFC 9728, for the Harness MCP server. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${HARNESS_MCP_PATH}`,
    authorization_servers: [issuerOf(origin)],
    scopes_supported: [HARNESS_OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Jod: Harness for Bank",
  };
}
