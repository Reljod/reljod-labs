import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { Visitor } from "@/platform/request/visitor";
import { type LoupeClaims, signLoupeToken } from "../mcp-token";
import type { LoupePorts } from "../ports";

export type Minted = { token: string; expiresAt: string };

/** Connect a client: an Owner's bearer token for the Loupe MCP server. */
export interface ConnectService {
  /**
   * A token for an outside MCP client (Claude Code, say) to act for this
   * Owner on /api/loupe/mcp. A Guest's lasts as long as their Guest pass and
   * dies when it is revoked; a Host's lasts 30 days. Shown once, never
   * stored; capped per Owner per day, and audited. A token minted by the
   * stubbed e2e suite reaches the stubbed services, nothing else does.
   */
  mint(input: {
    access: Access;
    owner: Owner;
    visitor: Visitor;
  }): Promise<Minted>;
}

const DAY = 86_400;

export function createConnectService(
  ports: Pick<LoupePorts, "rate" | "audit" | "secret" | "stub" | "now">,
): ConnectService {
  return {
    async mint({ access, owner, visitor }) {
      // Untrusted: the cap also makes the Owner's row; trusted skips both.
      await ports.rate.take("token", visitor, { owner });
      const now = Math.floor(ports.now() / 1000);
      const exp =
        access.kind === "guest"
          ? Math.floor(Date.parse(access.expiresAt) / 1000)
          : access.kind === "host"
            ? now + 30 * DAY
            : now + DAY;
      const claims: LoupeClaims =
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
                ...(ports.stub ? { stub: true } : {}),
              };
      const token = signLoupeToken(claims, ports.secret());
      const expiresAt = new Date(exp * 1000).toISOString();
      if (visitor.trusted) await ports.audit.ensureOwner(owner);
      await ports.audit.append(owner, "token.minted", "app", {
        kind: access.kind,
        expiresAt,
      });
      return { token, expiresAt };
    },
  };
}
