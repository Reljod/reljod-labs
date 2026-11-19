/**
 * A bank MCP token: which Owner and which Staff member a client acts for,
 * the visitor it spends against, and until when. Signed with
 * RATE_LIMIT_SALT, not stored. A Guest's token is also checked against their
 * Guest pass on every call, so it dies with the pass. The Teller's own token
 * (`via: "chat"`) lasts one turn and names its Session.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { type Owner, parseOwner } from "@/features/access/domain/owner";

export type BankClaims = {
  kind: "host" | "guest" | "e2e";
  owner: Owner;
  staffId: string;
  visitor: string;
  via: "chat" | "mcp";
  sessionId?: string;
  /** The Auth user a Guest token was minted for, and the Guest pass it was minted on. */
  user?: string;
  pass?: string;
  /** A Host token's account. */
  email?: string;
  /** Expiry, epoch seconds. */
  exp: number;
};

const PREFIX = "tdw_";

const sign = (payload: string, secret: string) =>
  createHmac("sha256", `bank-mcp:${secret}`)
    .update(payload)
    .digest("base64url");

export function signBankToken(claims: BankClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${PREFIX}${payload}.${sign(payload, secret)}`;
}

/** The claims of a token this server signed that has not expired, else null. */
export function readBankToken(
  token: string,
  secret: string,
  now = Date.now(),
): BankClaims | null {
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
    ) as BankClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (!parseOwner(claims.owner) || typeof claims.visitor !== "string")
      return null;
    if (
      typeof claims.staffId !== "string" ||
      !["chat", "mcp"].includes(claims.via)
    )
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
