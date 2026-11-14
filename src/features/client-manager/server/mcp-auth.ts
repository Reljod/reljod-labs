import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import { env as accessEnv } from "@/features/access/server/env";
import { type Access, requireAccess } from "@/features/access/server/gate";
import { guestPassOf } from "@/features/access/server/repository";
import {
  type McpClaims,
  readMcpToken,
  signMcpToken,
} from "../domain/mcp-token";
import { env } from "./env";
import {
  ensureSessionId,
  TRUSTED_VISITOR,
  type Visitor,
  visitor,
} from "./session";

const DAY = 86_400;

/**
 * The token an outside MCP client (Claude Code, say) sends as its bearer.
 * It reaches this browser session's clients and spends against this
 * visitor's limits. A Guest's token lasts as long as their Guest pass and is
 * refused the moment the pass is revoked; a Host's lasts 30 days.
 */
export async function mintMcpToken() {
  const access: Access = await requireAccess();
  const sessionId = await ensureSessionId();
  const who = await visitor();
  const now = Math.floor(Date.now() / 1000);
  const claims: McpClaims =
    access.kind === "guest"
      ? {
          kind: "guest",
          session: sessionId,
          visitor: who.hash,
          user: access.userId,
          pass: access.passId,
          exp: Math.floor(Date.parse(access.expiresAt) / 1000),
        }
      : access.kind === "host"
        ? {
            kind: "host",
            session: sessionId,
            visitor: who.hash,
            email: access.email,
            exp: now + 30 * DAY,
          }
        : {
            kind: "e2e",
            session: sessionId,
            visitor: who.hash,
            exp: now + DAY,
          };
  return {
    token: signMcpToken(claims, env.rateLimitSalt()),
    kind: claims.kind,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

/** The app's own chat: a token for one message, narrowed to the Thread's client. */
export function deskToken(input: {
  sessionId: string;
  visitor: Visitor;
  clientId: string | null;
}) {
  return signMcpToken(
    {
      kind: "desk",
      session: input.sessionId,
      visitor: input.visitor.hash,
      ...(input.clientId ? { client: input.clientId } : {}),
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
    },
    env.rateLimitSalt(),
  );
}

/**
 * The claims of a bearer, if it may still be used: signed here, not expired,
 * and its holder still has Access (a Guest pass still live, a Host still on
 * the Host list).
 */
export async function verifyBearer(bearer: string): Promise<McpClaims | null> {
  const claims = readMcpToken(bearer, env.rateLimitSalt());
  if (!claims) return null;
  switch (claims.kind) {
    case "desk":
      return claims;
    case "e2e":
      return env.e2eBypassToken() ? claims : null;
    case "host":
      return claims.email && accessEnv.hostEmails().includes(claims.email)
        ? claims
        : null;
    case "guest": {
      if (!claims.user || !claims.pass) return null;
      const pass = await guestPassOf(claims.user);
      if (!pass || pass.id !== claims.pass) return null;
      const status = guestPassStatus({
        expiresAt: pass.expires_at,
        revokedAt: pass.revoked_at,
      });
      return status === "live" ? claims : null;
    }
  }
}

export function visitorOf(claims: McpClaims): Visitor {
  return {
    hash: claims.visitor,
    trusted: claims.kind === "e2e" || claims.visitor === TRUSTED_VISITOR,
  };
}
