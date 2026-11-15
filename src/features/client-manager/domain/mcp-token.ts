import { createHmac, timingSafeEqual } from "node:crypto";
import { type Owner, parseOwner } from "@/features/access/domain/owner";

/**
 * A Client Manager MCP token: who may ask, for which Owner's book,
 * until when. Signed, not stored, so the server checks it without a lookup;
 * a Guest's token is also checked against their Guest pass on every call, so
 * it dies with the pass.
 */
export type McpClaims = {
  /** `desk` is the app's own chat, minted per message. */
  kind: "host" | "guest" | "e2e" | "desk";
  /**
   * The Access Owner whose clients the token reaches. Tokens minted before
   * Owners carried a browser session instead, and are refused.
   */
  owner: Owner;
  /** The rate-limit identity the token spends against. */
  visitor: string;
  /** The Auth user a Guest token was minted for. */
  user?: string;
  /** The Guest pass it was minted on. */
  pass?: string;
  /** A Host token's account. */
  email?: string;
  /** Narrows the token to one client (a Thread's scope). */
  client?: string;
  /** Expiry, epoch seconds. */
  exp: number;
};

const PREFIX = "cmm_";

const encode = (value: string) => Buffer.from(value).toString("base64url");
const sign = (payload: string, secret: string) =>
  createHmac("sha256", `client-manager-mcp:${secret}`)
    .update(payload)
    .digest("base64url");

export function signMcpToken(claims: McpClaims, secret: string) {
  const payload = encode(JSON.stringify(claims));
  return `${PREFIX}${payload}.${sign(payload, secret)}`;
}

/** The claims of a token this server signed and that has not expired, else null. */
export function readMcpToken(
  token: string,
  secret: string,
  now = Date.now(),
): McpClaims | null {
  if (!token.startsWith(PREFIX)) return null;
  const [payload, signature] = token.slice(PREFIX.length).split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as McpClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (!parseOwner(claims.owner) || typeof claims.visitor !== "string")
      return null;
    if (!["host", "guest", "e2e", "desk"].includes(claims.kind)) return null;
    return claims;
  } catch {
    return null;
  }
}
