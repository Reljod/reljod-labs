import "server-only";
import { InvalidError } from "@/platform/errors";
import type { McpConsentAnswer } from "../../domain/api";
import {
  guestAccessOAuth,
  type HostClaims,
  hostGrant,
} from "../../domain/guest-access-oauth";
import { callbackTrust, callbackVouched } from "../../domain/mcp-clients";
import { errorRedirect } from "../../domain/mcp-oauth";
import { type Owner, ownerOf } from "../../domain/owner";
import type { Access } from "../gate";
import type { HostAccess } from "../ports";
import { asHost } from "./common";

/** What connecting an MCP client to Guest access needs from outside. */
export type McpConnectPorts = {
  /** Signs tokens and authorization codes (`RATE_LIMIT_SALT`). */
  secret: () => string;
  /** Epoch milliseconds. */
  now: () => number;
  /** The account with this id, if it is a Host now (Auth admin API: no cookies here). */
  hostById: (userId: string) => Promise<HostAccess | null>;
  /** False once the Owner pressed "Disconnect all MCP clients" after `iat`. */
  issuedSinceDisconnect: (owner: Owner, iat: number) => Promise<boolean>;
  /** Records a code as used; false when it already was (`access.redeem_oauth_code`). */
  redeemCodeOnce: (code: string, expiresAt: number) => Promise<boolean>;
};

/** An OAuth endpoint's answer: the protocol's own JSON shape and status. */
export type OAuthAnswer = { status: number; body: unknown };

/** What the consent page shows, or where it sends the browser instead. */
export type ConsentReview =
  | { kind: "invalid"; message: string }
  | { kind: "sign-in" }
  | { kind: "redirect"; to: string }
  | {
      kind: "ask";
      /** The authorization request's query, checked again on Allow or Deny. */
      request: string;
      clientName: string;
      callbackHost: string;
      /** The callback is neither loopback nor a known client's. */
      unknownCallback: boolean;
      email: string;
    };

/**
 * Connecting an MCP client to the Guest access server, for Hosts only: the
 * consent page, its Allow and Deny, dynamic registration, the token endpoint,
 * and the check of every bearer the MCP server is sent. A token acts for a
 * Host's account only while it is still a Host with the same email and the
 * sign-in is newer than the Host's last "Disconnect all MCP clients".
 */
export interface McpConnectService {
  /**
   * The consent page, from its query. Anyone can register a client with any
   * https callback, so nobody but a Host is ever redirected to one.
   */
  review(access: Access | null, query: URLSearchParams): ConsentReview;
  /**
   * Where the browser goes after Allow or Deny: the client's callback, with
   * a code or an error. The authorization request is read again here, never
   * trusted from the page. A callback that is neither loopback nor a known
   * client's needs the Host to have ticked "I trust <host>".
   */
  answer(access: Access | null, input: McpConsentAnswer): { to: string };
  /** RFC 7591 dynamic registration. Nothing is stored and no Access is needed. */
  register(metadata: unknown): OAuthAnswer;
  /** A code (with its PKCE verifier) or a refresh token for an hour's access token. A code is redeemed once. */
  exchange(form: URLSearchParams): Promise<OAuthAnswer>;
  /** The Host a bearer acts for, if it may still be used. */
  verify(bearer: string): Promise<{ host: HostAccess; exp: number } | null>;
}

const ENDED = {
  error: "invalid_grant",
  error_description: "This access has ended. Sign in again.",
} as const;

const USED = {
  error: "invalid_grant",
  error_description: "This code was already used. Sign in again.",
} as const;

export function createMcpConnectService(
  ports: McpConnectPorts,
): McpConnectService {
  const oauth = guestAccessOAuth;

  /** Asked on every MCP request and before every token is minted. */
  async function hostOfClaims(
    claims: HostClaims,
    iat: number,
  ): Promise<HostAccess | null> {
    const [standing, host] = await Promise.all([
      ports.issuedSinceDisconnect(
        ownerOf({ kind: "host", userId: claims.userId }),
        iat,
      ),
      ports.hostById(claims.userId),
    ]);
    if (!standing || !host) return null;
    return host.email === claims.email.toLowerCase() ? host : null;
  }

  return {
    review(access, query) {
      const parsed = oauth.parseAuthorizationRequest(query, ports.secret());
      if (parsed.kind === "invalid")
        return { kind: "invalid", message: parsed.message };
      if (access?.kind !== "host") return { kind: "sign-in" };
      if (parsed.kind === "error")
        return { kind: "redirect", to: parsed.redirect };
      const { request } = parsed;
      return {
        kind: "ask",
        request: query.toString(),
        clientName: request.client.name,
        callbackHost: new URL(request.redirectUri).host,
        unknownCallback: callbackTrust(request.redirectUri) === "unknown",
        email: access.email,
      };
    },

    answer(access, input) {
      const host = asHost(access);
      const secret = ports.secret();
      const parsed = oauth.parseAuthorizationRequest(
        new URLSearchParams(input.request),
        secret,
      );
      if (parsed.kind === "invalid") throw new InvalidError(parsed.message);
      if (parsed.kind === "error") return { to: parsed.redirect };
      const { request } = parsed;
      if (input.answer !== "allow")
        return {
          to: errorRedirect(
            request.redirectUri,
            request.state,
            "access_denied",
            "The Host said no.",
          ),
        };
      if (!callbackVouched(request.redirectUri, input.trustHost))
        throw new InvalidError(
          `Tick "I trust ${new URL(request.redirectUri).host}" first, or Deny.`,
        );
      const now = ports.now();
      return {
        to: oauth.approvedRedirect(request, hostGrant(host, now), secret, now),
      };
    },

    register(metadata) {
      const result = oauth.registerClient(
        metadata,
        ports.secret(),
        ports.now(),
      );
      if (!result.ok) {
        const { ok: _ok, ...error } = result;
        return { status: 400, body: error };
      }
      return { status: 201, body: result.registration };
    },

    async exchange(form) {
      const secret = ports.secret();
      const now = ports.now();
      const result = oauth.redeem(form, secret, now);
      if (!result.ok) {
        const { ok: _ok, ...error } = result;
        return {
          status: error.error === "invalid_client" ? 401 : 400,
          body: error,
        };
      }
      if (!(await hostOfClaims(result.grant.claims, result.grant.iat)))
        return { status: 400, body: ENDED };
      // A code is good once: a second redemption, even within its two
      // minutes and with the right verifier, gets nothing.
      if (
        result.code &&
        !(await ports.redeemCodeOnce(result.code.value, result.code.exp))
      )
        return { status: 400, body: USED };
      return {
        status: 200,
        body: oauth.tokensFor(result.grant, result.clientId, secret, now),
      };
    },

    async verify(bearer) {
      const token = oauth.readAccessToken(bearer, ports.secret(), ports.now());
      if (!token) return null;
      const host = await hostOfClaims(token.claims, token.iat);
      return host ? { host, exp: token.exp } : null;
    },
  };
}
