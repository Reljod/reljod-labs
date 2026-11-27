import "server-only";
import { guestPassStatus } from "@/features/access/domain/guest-pass";
import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { Visitor } from "@/platform/request/visitor";
import {
  readMcpToken,
  type SwitchboardClaims,
  signMcpToken,
} from "../../domain/token";
import type { Caller, SwitchboardPorts } from "../ports";

export type MintedToken = { token: string; expiresAt: string };

/** "Connect a client": the signed token an outside MCP client acts as the Owner with. */
export interface ConnectService {
  /**
   * A token for /api/switchboard/mcp. A Guest's lasts as long as their Guest
   * pass; a Host's 30 days. It is signed, not stored: it is shown once.
   */
  mint(access: Access, owner: Owner, visitor: Visitor): Promise<MintedToken>;
  /**
   * Who a bearer acts for, checked against that Owner's Access on every call
   * (a live Guest pass, a Host still on the list), or null. `stub` is true
   * only for a token the stubbed e2e suite minted.
   */
  authenticate(bearer: string): Promise<{
    caller: Caller;
    stub: boolean;
    kind: SwitchboardClaims["kind"];
  } | null>;
}

const DAY = 86_400;

export function createConnectService(ports: SwitchboardPorts): ConnectService {
  const { access: tokens, store } = ports;

  async function stillAllowed(claims: SwitchboardClaims) {
    switch (claims.kind) {
      case "e2e":
        return tokens.e2e();
      case "host":
        return Boolean(
          claims.email && tokens.hostEmails().includes(claims.email),
        );
      case "guest": {
        if (!claims.user || !claims.pass) return false;
        const pass = await tokens.guestPass(claims.user);
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
    async mint(access, owner, visitor) {
      const now = Math.floor(ports.now() / 1000);
      const exp =
        access.kind === "guest"
          ? Math.floor(Date.parse(access.expiresAt) / 1000)
          : access.kind === "host"
            ? now + 30 * DAY
            : now + DAY;
      const claims: SwitchboardClaims =
        access.kind === "guest"
          ? {
              kind: "guest",
              owner,
              visitor: visitor.hash,
              user: access.userId,
              pass: access.passId,
              exp,
            }
          : access.kind === "host"
            ? {
                kind: "host",
                owner,
                visitor: visitor.hash,
                email: access.email,
                exp,
              }
            : {
                kind: "e2e",
                owner,
                visitor: visitor.hash,
                exp,
                ...(ports.stub ? { stub: true as const } : {}),
              };
      const token = signMcpToken(claims, tokens.secret());
      const expiresAt = new Date(exp * 1000).toISOString();
      await store.emit(owner, null, "owner", "mcp.token", { expiresAt });
      return { token, expiresAt };
    },

    async authenticate(bearer) {
      const claims = readMcpToken(bearer, tokens.secret(), ports.now());
      if (!claims || !(await stillAllowed(claims))) return null;
      await store.ensureWorkspace(claims.owner);
      return {
        caller: {
          owner: claims.owner,
          visitor: { hash: claims.visitor, trusted: claims.kind === "e2e" },
        },
        stub: claims.stub === true,
        kind: claims.kind,
      };
    },
  };
}
