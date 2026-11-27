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
  /**
   * `oauth` when an MCP client got it by signing in. A Guest's OAuth token
   * also needs their pasted guest token beside it (`guestTokenProblem`).
   */
  via?: "oauth";
  /** Narrows the token to one client (a Thread's scope). */
  client?: string;
  /**
   * When the access it carries was given, epoch seconds: a pasted or chat
   * token's mint time, an OAuth token's consent time. Checked against the
   * Owner's token epoch ("Disconnect all MCP clients"). Absent on tokens
   * minted before it existed.
   */
  iat?: number;
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
    if (claims.iat !== undefined && typeof claims.iat !== "number") return null;
    if (!parseOwner(claims.owner) || typeof claims.visitor !== "string")
      return null;
    if (!["host", "guest", "e2e", "desk"].includes(claims.kind)) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * A Guest who signs in with OAuth must also send their guest token (one
 * minted on the MCP page for the same Guest pass) in the `X-Guest-Token`
 * header, so the connection is tied to something only the Guest was given.
 * Returns why a request falls short, or null. Hosts and pasted tokens pass.
 */
export function guestTokenProblem(
  claims: McpClaims,
  header: string | null,
  secret: string,
  now = Date.now(),
): string | null {
  if (claims.kind !== "guest" || claims.via !== "oauth") return null;
  if (!header)
    return "Guests also send their guest token in the X-Guest-Token header. Get it on the Client Manager MCP page.";
  const key = readMcpToken(header, secret, now);
  if (
    !key ||
    key.kind !== "guest" ||
    key.via === "oauth" ||
    key.pass !== claims.pass ||
    key.owner !== claims.owner
  )
    return "X-Guest-Token is not a guest token for this guest pass. Get a new one on the Client Manager MCP page.";
  return null;
}
