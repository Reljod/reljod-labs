import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import { issuedSinceDisconnect } from "@/features/access/server/mcp-tokens";
import { guestPassOf } from "@/features/access/server/repository";
import { E2E_VISITOR_HASH, type Visitor } from "@/platform/request/visitor";
import {
  type McpClaims,
  readMcpToken,
  signMcpToken,
} from "../domain/mcp-token";
import { env } from "./env";

/** The app's own chat: a token for one message, narrowed to the Thread's client. */
export function deskToken(input: {
  owner: Owner;
  visitor: Visitor;
  clientId: string | null;
}) {
  return signMcpToken(
    {
      kind: "desk",
      owner: input.owner,
      visitor: input.visitor.hash,
      ...(input.clientId ? { client: input.clientId } : {}),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
    },
    env.rateLimitSalt(),
  );
}

/**
 * The claims of a bearer, if it may still be used: signed here, not expired,
 * its holder still has Access (a Guest pass still live, a Host still on the
 * Host list), and issued after its Owner last pressed "Disconnect all MCP
 * clients". The token endpoint checks every token it mints here too, so a
 * refresh token or code from before a disconnect mints nothing.
 */
export async function verifyBearer(bearer: string): Promise<McpClaims | null> {
  const claims = readMcpToken(bearer, env.rateLimitSalt());
  if (!claims) return null;
  const [standing, holder] = await Promise.all([
    issuedSinceDisconnect(claims.owner, claims.iat),
    holderOf(claims),
  ]);
  return standing ? holder : null;
}

async function holderOf(claims: McpClaims): Promise<McpClaims | null> {
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
      if (claims.owner !== `guest:${claims.pass}`) return null;
      const pass = await guestPassOf(claims.user);
      if (!pass || pass.id !== claims.pass) return null;
      const status = guestPassStatus({
        expiresAt: pass.expires_at,
        revokedAt: pass.revoked_at,
        deletedAt: pass.deleted_at,
      });
      return status === "live" ? claims : null;
    }
  }
}

/** Whose caps an MCP call spends: the token's visitor; the e2e suite's are not capped. */
export function visitorOfClaims(claims: McpClaims): Visitor {
  return {
    hash: claims.visitor,
    trusted: claims.kind === "e2e" || claims.visitor === E2E_VISITOR_HASH,
  };
}
