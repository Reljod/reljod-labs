import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { Visitor } from "@/platform/request/visitor";
import type { TokenResponse } from "../../domain/api";
import type { SievePorts } from "../ports";
import type { SieveClaims } from "../toolkit/mcp-token";

/** "Connect a client": an Owner's bearer token for the Sieve MCP server. */
export interface ConnectService {
  /**
   * A token for an outside MCP client (Claude Code, say) to act for this
   * Owner on /api/name-extraction/mcp. A Guest's lasts as long as their
   * Guest pass and dies when it is revoked; a Host's lasts 30 days. Signed,
   * shown once, never stored.
   */
  mint(input: {
    access: Access;
    owner: Owner;
    visitor: Visitor;
  }): Promise<TokenResponse>;
}

const DAY = 86_400;

export function createConnectService(
  ports: Pick<SievePorts, "signToken" | "now" | "stub">,
): ConnectService {
  return {
    async mint({ access, owner, visitor }) {
      const now = Math.floor(ports.now() / 1000);
      const exp =
        access.kind === "guest"
          ? Math.floor(Date.parse(access.expiresAt) / 1000)
          : access.kind === "host"
            ? now + 30 * DAY
            : now + DAY;
      const claims: SieveClaims =
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
            : // A token the stubbed suite mints reaches the stubbed services.
              {
                kind: "e2e",
                owner,
                visitor: visitor.hash,
                exp,
                ...(ports.stub ? { stub: true } : {}),
              };
      return {
        token: ports.signToken(claims),
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    },
  };
}
