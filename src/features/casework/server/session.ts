import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { type Owner, parseOwner } from "@/features/access/domain/owner";
import { env } from "./env";

/*
 * The token the desk's chat calls its own MCP server with. Which Desk a
 * browser has open is the REST layer's concern (`server/api.ts`); a Desk is
 * reached only through its Owner (`services/desks.ts`).
 */

/** How long the desk's chat may use one session token: one message's turn and its tools. */
export const SESSION_TOKEN_SECONDS = 60 * 60;

const TOKEN_PREFIX = "cws1.";

/** What a session token says: the Desk, its Owner (null for the outside client's desk) and until when. */
export type SessionTokenClaims = {
  sessionId: string;
  owner: Owner | null;
  exp: number;
};

const signSession = (payload: string, secret: string) =>
  createHmac("sha256", `casework-mcp-session:${secret}`)
    .update(payload)
    .digest("base64url");

/**
 * A bearer token that lets the MCP server act for one Desk, for its Owner,
 * for an hour. Minted per chat message; never handed to the browser.
 */
export function sessionToken(
  session: { id: string; owner: Owner | null },
  now = Date.now(),
  secret = env.rateLimitSalt(),
) {
  const claims: SessionTokenClaims = {
    sessionId: session.id,
    owner: session.owner,
    exp: Math.floor(now / 1000) + SESSION_TOKEN_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${TOKEN_PREFIX}${payload}.${signSession(payload, secret)}`;
}

/** The claims of a session token signed here and not expired, else null. */
export function verifySessionToken(
  token: string,
  now = Date.now(),
  secret = env.rateLimitSalt(),
): SessionTokenClaims | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [payload, signature, ...rest] = token
    .slice(TOKEN_PREFIX.length)
    .split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(signSession(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<SessionTokenClaims>;
    if (typeof claims.sessionId !== "string" || !claims.sessionId) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (claims.owner !== null && !parseOwner(claims.owner)) return null;
    return {
      sessionId: claims.sessionId,
      owner: claims.owner ?? null,
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Whether a Desk row still belongs to the Owner a session token named. Null
 * matches only null: the outside client's desk, which has no Owner.
 */
export function ownerMatches(rowOwner: Owner | null, tokenOwner: unknown) {
  return (
    (tokenOwner === null || typeof tokenOwner === "string") &&
    rowOwner === tokenOwner
  );
}
