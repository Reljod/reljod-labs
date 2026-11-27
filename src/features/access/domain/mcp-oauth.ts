import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { LOOPBACK_HOSTS } from "./mcp-clients";

/*
 * A stateless OAuth 2.1 authorization server for one MCP server (ADR 0012's
 * design): the registered client, the authorization code, the refresh token
 * and the access token are each a signed blob, so nothing is stored but the
 * codes already redeemed and the Owner's token epoch (`server/mcp-tokens.ts`).
 *
 * `statelessOAuth(config, readClaims)` builds one for a server. Every blob it
 * signs carries the server's own prefix and HMAC context, so nothing another
 * server signs with the same salt ever verifies here.
 *
 * The Client Manager and the Harness still carry their own copies of this
 * (`features/*\/domain/oauth.ts`); new servers use this one.
 */

export type OAuthServerConfig = {
  /** Two letters: blobs start `<prefix>m_` (access token), `c_`, `o_`, `r_`. */
  prefix: string;
  /** The HMAC context every blob is signed under. */
  context: string;
  scope: string;
  /** The issuer's path; its RFC 8414 metadata sits under `/.well-known/oauth-authorization-server<issuerPath>`. */
  issuerPath: string;
  mcpPath: string;
  /** `<oauthPath>/register` and `<oauthPath>/token`. */
  oauthPath: string;
  /** The consent page. */
  authorizePath: string;
  /** Shown by clients (RFC 9728 `resource_name`) and in the consent page's errors. */
  resourceName: string;
};

/** What a person allowed: the claims every access token carries, when they allowed it, and when it ends. */
export type Grant<C> = { claims: C; iat: number; until: number };

/** A verified access token. */
export type AccessToken<C> = { claims: C; iat: number; exp: number };

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

export type OAuthClient = { name: string; redirectUris: string[] };

export type AuthorizationRequest = {
  clientId: string;
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

/** An access token lives an hour; the client refreshes it until the Grant ends. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** Long enough for a redirect and a token request. */
export const CODE_SECONDS = 2 * 60;

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

/** The S256 challenge of a PKCE verifier. */
export const pkceChallenge = (verifier: string) => sha256(verifier);

function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const fail = (
  error: OAuthErrorCode,
  description: string,
): { ok: false } & OAuthError => ({
  ok: false,
  error,
  error_description: description,
});

const isSeconds = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** https anywhere, or http on this machine (a CLI's local callback, RFC 8252). */
export function redirectUriAllowed(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
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
  if (given.protocol !== "http:" || !LOOPBACK_HOSTS.has(given.hostname))
    return false;
  return client.redirectUris.some((registered) => {
    let url: URL;
    try {
      url = new URL(registered);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname))
      return false;
    url.port = given.port;
    return url.href === given.href;
  });
}

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

type Code<C> = {
  client: string;
  redirectUri: string;
  challenge: string;
  grant: Grant<C>;
  exp: number;
};

type Refresh<C> = { client: string; grant: Grant<C> };

type Kind = "token" | "client" | "code" | "refresh";
const LETTER: Record<Kind, string> = {
  token: "m",
  client: "c",
  code: "o",
  refresh: "r",
};

/**
 * One MCP server's authorization server. `readClaims` checks the claims read
 * back from a blob and returns them typed, or null: every blob is checked
 * with it, so a Grant signed before the claims changed shape is refused.
 */
export function statelessOAuth<C>(
  config: OAuthServerConfig,
  readClaims: (value: unknown) => C | null,
) {
  const prefixOf = (kind: Kind) => `${config.prefix}${LETTER[kind]}_`;
  const hmac = (kind: Kind, payload: string, secret: string) =>
    createHmac("sha256", `${config.context}:${kind}:${secret}`)
      .update(payload)
      .digest("base64url");

  function seal(kind: Kind, value: unknown, secret: string) {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${prefixOf(kind)}${payload}.${hmac(kind, payload, secret)}`;
  }

  function unseal(kind: Kind, blob: unknown, secret: string): unknown {
    const prefix = prefixOf(kind);
    if (typeof blob !== "string" || !blob.startsWith(prefix)) return null;
    const [payload, signature, ...rest] = blob.slice(prefix.length).split(".");
    if (!payload || !signature || rest.length > 0) return null;
    if (!sameText(hmac(kind, payload, secret), signature)) return null;
    try {
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }

  function grantFrom(value: unknown): Grant<C> | null {
    if (!value || typeof value !== "object") return null;
    const grant = value as Partial<Grant<unknown>>;
    if (!isSeconds(grant.iat) || !isSeconds(grant.until)) return null;
    const claims = readClaims(grant.claims);
    return claims === null
      ? null
      : { claims, iat: grant.iat, until: grant.until };
  }

  // Access tokens -------------------------------------------------------------------

  function signAccessToken(token: AccessToken<C>, secret: string) {
    return seal("token", token, secret);
  }

  /** A token signed here and not expired, else null. */
  function readAccessToken(
    blob: unknown,
    secret: string,
    now = Date.now(),
  ): AccessToken<C> | null {
    const value = unseal("token", blob, secret) as Partial<
      AccessToken<unknown>
    > | null;
    if (!value || typeof value !== "object") return null;
    if (!isSeconds(value.exp) || value.exp * 1000 <= now) return null;
    if (!isSeconds(value.iat)) return null;
    const claims = readClaims(value.claims);
    return claims === null ? null : { claims, iat: value.iat, exp: value.exp };
  }

  // Clients (RFC 7591) ----------------------------------------------------------------

  /** Registers a public client: the id it gets back is its own signed registration. */
  function registerClient(body: unknown, secret: string, now: number) {
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
    if (
      Array.isArray(grantTypes) &&
      !grantTypes.includes("authorization_code")
    ) {
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
        scope: config.scope,
      },
    };
  }

  function readClient(clientId: unknown, secret: string): OAuthClient | null {
    const client = unseal("client", clientId, secret) as OAuthClient | null;
    if (
      !client ||
      typeof client.name !== "string" ||
      !Array.isArray(client.redirectUris) ||
      !client.redirectUris.every((uri) => typeof uri === "string")
    )
      return null;
    return client;
  }

  // The authorization request ----------------------------------------------------------

  /** This server's MCP endpoint, on any origin the site answers on. */
  function isOwnResource(resource: string) {
    try {
      return new URL(resource).pathname.replace(/\/$/, "") === config.mcpPath;
    } catch {
      return false;
    }
  }

  /**
   * Reads the consent page's query. An unknown client or redirect URI is
   * shown on the page and never redirected to; anything else wrong goes back
   * to the client as an OAuth error.
   */
  function parseAuthorizationRequest(
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
        message: `This sign-in link names an app ${config.resourceName} does not know. Start again from the app.`,
      };
    const given = params.get("redirect_uri");
    const redirectUri =
      given ??
      (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
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
    if (!codeChallenge || !PKCE_CHALLENGE.test(codeChallenge))
      return back("invalid_request", "A PKCE code_challenge is required.");
    if (params.get("code_challenge_method") !== "S256")
      return back("invalid_request", "code_challenge_method must be S256.");
    const resource = params.get("resource");
    if (resource && !isOwnResource(resource))
      return back(
        "invalid_target",
        `This server only grants ${config.mcpPath}.`,
      );
    return {
      kind: "ok",
      request: { clientId, client, redirectUri, state, codeChallenge },
    };
  }

  // Codes and tokens -----------------------------------------------------------------

  /** Where the consent page sends the person once they allow. */
  function approvedRedirect(
    request: AuthorizationRequest,
    grant: Grant<C>,
    secret: string,
    now: number,
  ) {
    const code: Code<C> = {
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

  /** A fresh access token from the Grant, and a refresh token for the rest of it. */
  function tokensFor(
    grant: Grant<C>,
    clientId: string,
    secret: string,
    now: number,
  ): TokenResponse {
    const seconds = Math.floor(now / 1000);
    const exp = Math.min(seconds + ACCESS_TOKEN_SECONDS, grant.until);
    const refresh: Refresh<C> = { client: sha256(clientId), grant };
    return {
      access_token: signAccessToken(
        { claims: grant.claims, iat: grant.iat, exp },
        secret,
      ),
      token_type: "Bearer",
      expires_in: exp - seconds,
      refresh_token: seal("refresh", refresh, secret),
      scope: config.scope,
    };
  }

  /**
   * The token endpoint's two grants. Returns the Grant to mint from (and the
   * code traded, for `redeemCodeOnce`); the caller checks the holder still
   * has Access before minting.
   */
  function redeem(
    form: URLSearchParams,
    secret: string,
    now: number,
  ):
    | {
        ok: true;
        grant: Grant<C>;
        clientId: string;
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
        const code = unseal("code", given, secret) as Code<unknown> | null;
        const grant = code ? grantFrom(code.grant) : null;
        if (
          !code ||
          !grant ||
          !isSeconds(code.exp) ||
          code.exp <= seconds ||
          code.client !== sha256(clientId)
        )
          return fail("invalid_grant", "The code is unknown or has expired.");
        if (form.get("redirect_uri") !== code.redirectUri)
          return fail("invalid_grant", "redirect_uri does not match.");
        const verifier = form.get("code_verifier");
        if (
          !verifier ||
          !PKCE_VERIFIER.test(verifier) ||
          pkceChallenge(verifier) !== code.challenge
        )
          return fail(
            "invalid_grant",
            "The PKCE code_verifier does not match.",
          );
        if (grant.until <= seconds)
          return fail("invalid_grant", "This access has ended. Sign in again.");
        return {
          ok: true,
          grant,
          clientId,
          code: { value: given as string, exp: code.exp },
        };
      }
      case "refresh_token": {
        const refresh = unseal(
          "refresh",
          form.get("refresh_token"),
          secret,
        ) as Refresh<unknown> | null;
        const grant = refresh ? grantFrom(refresh.grant) : null;
        if (!refresh || !grant || refresh.client !== sha256(clientId))
          return fail("invalid_grant", "The refresh token is unknown.");
        if (grant.until <= seconds)
          return fail("invalid_grant", "This access has ended. Sign in again.");
        return { ok: true, grant, clientId };
      }
      default:
        return fail(
          "unsupported_grant_type",
          "Use authorization_code or refresh_token.",
        );
    }
  }

  // Metadata ----------------------------------------------------------------------------

  const issuerOf = (origin: string) => `${origin}${config.issuerPath}`;

  /** RFC 8414, served at `/.well-known/oauth-authorization-server<issuerPath>`. */
  function authorizationServerMetadata(origin: string) {
    return {
      issuer: issuerOf(origin),
      authorization_endpoint: `${origin}${config.authorizePath}`,
      token_endpoint: `${origin}${config.oauthPath}/token`,
      registration_endpoint: `${origin}${config.oauthPath}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [config.scope],
    };
  }

  /** RFC 9728, for the MCP server. */
  function protectedResourceMetadata(origin: string) {
    return {
      resource: `${origin}${config.mcpPath}`,
      authorization_servers: [issuerOf(origin)],
      scopes_supported: [config.scope],
      bearer_methods_supported: ["header"],
      resource_name: config.resourceName,
    };
  }

  return {
    config,
    signAccessToken,
    readAccessToken,
    registerClient,
    readClient,
    parseAuthorizationRequest,
    approvedRedirect,
    tokensFor,
    redeem,
    authorizationServerMetadata,
    protectedResourceMetadata,
  };
}

export type StatelessOAuth<C> = ReturnType<typeof statelessOAuth<C>>;
