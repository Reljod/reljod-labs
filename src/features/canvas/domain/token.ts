/**
 * A Canvas MCP token: which Owner an MCP client acts for, the visitor it
 * spends against, and until when. Signed with RATE_LIMIT_SALT, not stored. A
 * Guest's token is also checked against their Guest pass on every call, so
 * it dies with the pass. Pure apart from node:crypto.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { type Owner, parseOwner } from "@/features/access/domain/owner";

/** Who holds it: a chat turn (the Analyst), the page's Host (a person at a Control) or an outside client. */
export const TOKEN_VIAS = ["chat", "host", "pasted"] as const;
export type TokenVia = (typeof TOKEN_VIAS)[number];

export type CanvasClaims = {
  kind: "host" | "guest" | "e2e";
  via: TokenVia;
  owner: Owner;
  visitor: string;
  /** The Auth user a Guest token was minted for. */
  user?: string;
  /** The Guest pass it was minted on. */
  pass?: string;
  /** A Host token's account. */
  email?: string;
  /** A chat turn's Conversation and Question: its Views are filed there, its caps apply. */
  conversationId?: string;
  questionId?: string;
  /** Expiry, epoch seconds. */
  exp: number;
};

export const TOKEN_PREFIX = "canvas_";

const sign = (payload: string, secret: string) =>
  createHmac("sha256", `canvas-mcp:${secret}`)
    .update(payload)
    .digest("base64url");

export function signCanvasToken(claims: CanvasClaims, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${TOKEN_PREFIX}${payload}.${sign(payload, secret)}`;
}

const optionalText = (value: unknown) =>
  value === undefined || typeof value === "string";

/** The claims of a token this server signed that has not expired, else null. */
export function readCanvasToken(
  token: unknown,
  secret: string,
  now = Date.now(),
): CanvasClaims | null {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  const [payload, signature, ...rest] = token
    .slice(TOKEN_PREFIX.length)
    .split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as CanvasClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (!parseOwner(claims.owner) || typeof claims.visitor !== "string")
      return null;
    if (!["host", "guest", "e2e"].includes(claims.kind)) return null;
    if (!TOKEN_VIAS.includes(claims.via)) return null;
    if (claims.kind === "guest" && claims.owner !== `guest:${claims.pass}`)
      return null;
    if (claims.kind === "host" && !claims.owner.startsWith("host:"))
      return null;
    if (claims.kind === "e2e" && claims.owner !== "e2e") return null;
    if (
      !optionalText(claims.conversationId) ||
      !optionalText(claims.questionId) ||
      !optionalText(claims.user) ||
      !optionalText(claims.pass) ||
      !optionalText(claims.email)
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}
