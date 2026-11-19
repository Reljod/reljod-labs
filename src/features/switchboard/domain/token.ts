/**
 * A Switchboard MCP token: which Owner an outside MCP client acts for, the visitor
 * it spends against, and until when. Signed with RATE_LIMIT_SALT, not
 * stored. A Guest's token is also checked against their Guest pass on every
 * call, so it dies with the pass. Pure apart from node:crypto.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { type Owner, parseOwner } from "@/features/access/domain/owner";

export type SwitchboardClaims = {
  kind: "host" | "guest" | "e2e";
  owner: Owner;
  visitor: string;
  /** The Auth user a Guest token was minted for. */
  user?: string;
  /** The Guest pass it was minted on. */
  pass?: string;
  /** A Host token's account. */
  email?: string;
  /** Expiry, epoch seconds. */
  exp: number;
};

const PREFIX = "swb_";

const sign = (payload: string, secret: string) =>
  createHmac("sha256", `switchboard-mcp:${secret}`)
    .update(payload)
    .digest("base64url");

export function signMcpToken(claims: SwitchboardClaims, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${PREFIX}${payload}.${sign(payload, secret)}`;
}

/** The claims of a token this server signed that has not expired, else null. */
export function readMcpToken(
  token: string,
  secret: string,
  now = Date.now(),
): SwitchboardClaims | null {
  if (!token.startsWith(PREFIX)) return null;
  const [payload, signature, ...rest] = token.slice(PREFIX.length).split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SwitchboardClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (!parseOwner(claims.owner) || typeof claims.visitor !== "string")
      return null;
    if (!["host", "guest", "e2e"].includes(claims.kind)) return null;
    if (claims.kind === "guest" && claims.owner !== `guest:${claims.pass}`)
      return null;
    if (claims.kind === "host" && !claims.owner.startsWith("host:"))
      return null;
    if (claims.kind === "e2e" && claims.owner !== "e2e") return null;
    return claims;
  } catch {
    return null;
  }
}
