import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { Grant } from "./oauth";

const DAY = 86_400;

/**
 * What a visitor may hand an outside MCP client (Claude Code, say): their
 * Owner's clients (a Guest's are their Guest pass's, shared by every device
 * on it), spending against this visitor's limits. A Guest's lasts as long as
 * their Guest pass and is refused the moment the pass is revoked; a Host's
 * lasts 30 days. The OAuth consent and the token page both mint from it,
 * with the Access the request's own gate just read. Pure.
 */
export function grantOf(
  access: Access,
  owner: Owner,
  visitor: { hash: string },
  nowMs: number,
): Grant & { kind: Access["kind"] } {
  const now = Math.floor(nowMs / 1000);
  if (access.kind === "guest")
    return {
      kind: "guest",
      owner,
      visitor: visitor.hash,
      iat: now,
      user: access.userId,
      pass: access.passId,
      until: Math.floor(Date.parse(access.expiresAt) / 1000),
    };
  if (access.kind === "host")
    return {
      kind: "host",
      owner,
      visitor: visitor.hash,
      iat: now,
      email: access.email,
      until: now + 30 * DAY,
    };
  return {
    kind: "e2e",
    owner,
    visitor: visitor.hash,
    iat: now,
    until: now + DAY,
  };
}
