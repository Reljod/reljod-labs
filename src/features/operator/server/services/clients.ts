import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { Visitor } from "@/platform/request/visitor";
import {
  type OperatorClaims,
  readOperatorToken,
  signOperatorToken,
} from "../mcp-token";
import type { AccessLookup } from "../ports";
import type { Caller } from "./runs";

/*
 * Outside MCP clients (Claude Code, say) act for one Owner with a bearer
 * token the Owner mints on "Connect a client". The token is signed, not
 * stored, and is checked against the Owner's Access on every call, so it
 * dies with a Guest pass and with a Host taken off the list.
 */

export interface ClientTokenService {
  /** A Guest's token lasts as long as their Guest pass; a Host's 30 days. */
  mint(
    access: Access,
    owner: Owner,
    visitor: Visitor,
  ): { token: string; expiresAt: string };
  /** The caller a bearer token acts as, or null when it is not one this server signed for someone still allowed. */
  caller(
    bearer: string,
  ): Promise<(Caller & { kind: OperatorClaims["kind"] }) | null>;
}

export function createClientTokenService(ports: {
  access: AccessLookup;
  now: () => number;
}): ClientTokenService {
  const { access } = ports;

  /** Whether a signed token's holder still has Access: a live Guest pass, a Host still on the list. */
  async function stillAllowed(claims: OperatorClaims) {
    switch (claims.kind) {
      case "e2e":
        return access.e2eEnabled();
      case "host":
        return Boolean(
          claims.email && access.hostEmails().includes(claims.email),
        );
      case "guest": {
        if (!claims.user || !claims.pass) return false;
        const pass = await access.guestPass(claims.user);
        if (!pass || pass.id !== claims.pass) return false;
        return (
          guestPassStatus({
            expiresAt: pass.expires_at,
            revokedAt: pass.revoked_at,
            deletedAt: pass.deleted_at,
          }) === "live"
        );
      }
    }
  }

  return {
    mint(holder, owner, visitor) {
      const now = Math.floor(ports.now() / 1000);
      const exp =
        holder.kind === "guest"
          ? Math.floor(Date.parse(holder.expiresAt) / 1000)
          : holder.kind === "host"
            ? now + 30 * 86_400
            : now + 86_400;
      const token = signOperatorToken(
        holder.kind === "guest"
          ? {
              kind: "guest",
              owner,
              visitor: visitor.hash,
              user: holder.userId,
              pass: holder.passId,
              exp,
            }
          : holder.kind === "host"
            ? {
                kind: "host",
                owner,
                visitor: visitor.hash,
                email: holder.email,
                exp,
              }
            : { kind: "e2e", owner, visitor: visitor.hash, exp },
        access.secret(),
      );
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    },

    async caller(bearer) {
      const claims = readOperatorToken(bearer, access.secret(), ports.now());
      if (!claims || !(await stillAllowed(claims))) return null;
      return {
        kind: claims.kind,
        owner: claims.owner,
        visitor: { hash: claims.visitor, trusted: claims.kind === "e2e" },
      };
    },
  };
}
