import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import { env as accessEnv } from "@/features/access/server/env";
import { type Access, requireOwner } from "@/features/access/server/gate";
import { guestPassOf } from "@/features/access/server/repository";
import {
  type McpClaims,
  readMcpToken,
  signMcpToken,
} from "../domain/mcp-token";
import type { Grant } from "../domain/oauth";
import { env } from "./env";
import { TRUSTED_VISITOR, type Visitor, visitor } from "./session";

const DAY = 86_400;

/**
 * What this visitor may hand an outside MCP client (Claude Code, say): their
 * Owner's clients (a Guest's are their Guest pass's, shared by every device
 * on it), spending against this visitor's limits. A Guest's lasts as long as
 * their Guest pass and is refused the moment the pass is revoked; a Host's
 * lasts 30 days. The OAuth consent page and the token page both mint from it.
 */
export async function currentGrant(): Promise<Grant> {
  const { access, owner }: { access: Access; owner: Owner } =
    await requireOwner();
  const who = await visitor();
  const now = Math.floor(Date.now() / 1000);
  return access.kind === "guest"
    ? {
        kind: "guest",
        owner,
        visitor: who.hash,
        user: access.userId,
        pass: access.passId,
        until: Math.floor(Date.parse(access.expiresAt) / 1000),
      }
    : access.kind === "host"
      ? {
          kind: "host",
          owner,
          visitor: who.hash,
          email: access.email,
          until: now + 30 * DAY,
        }
      : { kind: "e2e", owner, visitor: who.hash, until: now + DAY };
}

/** A token to paste, for MCP clients that cannot sign in with OAuth. */
export async function mintMcpToken() {
  const { until, ...claims } = await currentGrant();
  return {
    token: signMcpToken({ ...claims, exp: until }, env.rateLimitSalt()),
    kind: claims.kind,
    expiresAt: new Date(until * 1000).toISOString(),
  };
}

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

export function visitorOf(claims: McpClaims): Visitor {
  return {
    hash: claims.visitor,
    trusted: claims.kind === "e2e" || claims.visitor === TRUSTED_VISITOR,
  };
}
