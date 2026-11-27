import { callbackVouched } from "@/features/access/domain/mcp-clients";
import { type Owner, ownerOf } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import { InvalidError, UnauthorizedError } from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import type { McpTokenResponse } from "../../domain/api";
import type { ConsentAnswer } from "../../domain/consent";
import { grantOf } from "../../domain/grant";
import { type McpClaims, signMcpToken } from "../../domain/mcp-token";
import {
  approvedRedirect,
  errorRedirect,
  parseAuthorizationRequest,
  redeem,
  registerClient,
  tokensFor,
} from "../../domain/oauth";

const ENDED = "Your access has ended. Sign in again, then retry.";

export type ConnectPorts = {
  /** Signs tokens and authorization codes (`RATE_LIMIT_SALT`). */
  secret: () => string;
  now: () => number;
  /** Records a code as used; false when it already was (`access.redeem_oauth_code`). */
  redeemCodeOnce: (code: string, expiresAt: number) => Promise<boolean>;
  /** The claims of a token if its holder may still use it. */
  verify: (token: string) => Promise<McpClaims | null>;
};

/** An OAuth endpoint's answer: the protocol's own JSON shape and status. */
export type OAuthAnswer = { status: number; body: unknown };

/**
 * Connecting an outside MCP client: a token to paste, or the OAuth consent
 * page's Allow and Deny. Both mint from the Grant of whoever the request's
 * gate let in, so a revoked Guest pass or a Host taken off the list gets
 * nothing new.
 */
export interface ConnectService {
  /** A token to paste, for MCP clients that cannot sign in with OAuth. */
  mint(caller: {
    access: Access;
    owner: Owner;
    visitor: Visitor;
  }): McpTokenResponse;
  /**
   * Where the browser goes after Allow or Deny: the client's callback, with
   * a code or an error. Nothing is redirected anywhere for a visitor without
   * Access, so the answer is no open redirect. A callback that is neither
   * loopback nor a known client's needs the person to have ticked
   * "I trust <host>".
   */
  answer(
    access: Access | null,
    visitor: Visitor,
    input: ConsentAnswer,
  ): Promise<{ to: string }>;
  /**
   * RFC 7591 dynamic registration. Nothing is stored: the client id is the
   * signed registration, so registering costs nothing and needs no Access.
   */
  register(metadata: unknown): OAuthAnswer;
  /**
   * The token endpoint: a code (with its PKCE verifier) or a refresh token
   * for an hour's MCP token. Each time it checks the holder still has Access
   * and the Grant was given after the Owner last disconnected their MCP
   * clients, so a revoked Guest pass, a Host taken off the list or a
   * disconnected client gets nothing more. A code is redeemed once.
   */
  exchange(form: URLSearchParams): Promise<OAuthAnswer>;
}

export function createConnectService(ports: ConnectPorts): ConnectService {
  return {
    mint({ access, owner, visitor }) {
      const { until, ...claims } = grantOf(access, owner, visitor, ports.now());
      return {
        token: signMcpToken({ ...claims, exp: until }, ports.secret()),
        kind: claims.kind,
        expiresAt: new Date(until * 1000).toISOString(),
      };
    },

    async answer(access, visitor, input) {
      if (!access) throw new UnauthorizedError(ENDED);
      const secret = ports.secret();
      const parsed = parseAuthorizationRequest(
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
            "The person said no.",
          ),
        };
      if (!callbackVouched(request.redirectUri, input.trustHost))
        throw new InvalidError(
          `Tick "I trust ${new URL(request.redirectUri).host}" first, or Deny.`,
        );
      const now = ports.now();
      const grant = grantOf(access, ownerOf(access), visitor, now);
      return { to: approvedRedirect(request, grant, secret, now) };
    },

    register(metadata) {
      const result = registerClient(metadata, ports.secret(), ports.now());
      if (!result.ok) {
        const { ok: _ok, ...error } = result;
        return { status: 400, body: error };
      }
      return { status: 201, body: result.registration };
    },

    async exchange(form) {
      const secret = ports.secret();
      const now = ports.now();
      const result = redeem(form, secret, now);
      if (!result.ok) {
        const { ok: _ok, ...error } = result;
        return {
          status: error.error === "invalid_client" ? 401 : 400,
          body: error,
        };
      }
      // A code is good once: a second redemption, even within its two
      // minutes and with the right verifier, gets nothing.
      if (
        result.code &&
        !(await ports.redeemCodeOnce(result.code.value, result.code.exp))
      )
        return {
          status: 400,
          body: {
            error: "invalid_grant",
            error_description: "This code was already used. Sign in again.",
          },
        };
      const tokens = tokensFor(result.grant, result.clientId, secret, now);
      if (!(await ports.verify(tokens.access_token)))
        return {
          status: 400,
          body: {
            error: "invalid_grant",
            error_description: "This access has ended. Sign in again.",
          },
        };
      return { status: 200, body: tokens };
    },
  };
}
