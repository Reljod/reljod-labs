import "server-only";

/**
 * A Loupe MCP token: which Owner the bearer acts for, the visitor it spends
 * against, and until when. Signed with RATE_LIMIT_SALT, not stored. Two
 * sorts: an Owner's token for an outside client ("Connect a client"; a
 * Guest's is also checked against their Guest pass on every call), and the
 * short-lived token the in-app Examiner carries, bound to one Examination.
 * Pure apart from node:crypto.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { type Owner, parseOwner } from "@/features/access/domain/owner";

export type LoupeClaims = {
  kind: "host" | "guest" | "e2e" | "examiner";
  owner: Owner;
  visitor: string;
  /** Whether the visitor skips rate limits (the e2e suite). */
  trusted?: boolean;
  /** The Auth user a Guest token was minted for. */
  user?: string;
  /** The Guest pass it was minted on. */
  pass?: string;
  /** A Host token's account. */
  email?: string;
  /** An Examiner token's one Examination. */
  examinationId?: string;
  /** Where the Examination was started from, for a Sample's file. */
  origin?: string;
  /** Expiry, epoch seconds. */
  exp: number;
};

const PREFIX = "loupe_";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sign = (payload: string, secret: string) =>
  createHmac("sha256", `loupe-mcp:${secret}`)
    .update(payload)
    .digest("base64url");

export function signLoupeToken(claims: LoupeClaims, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${PREFIX}${payload}.${sign(payload, secret)}`;
}

/** The claims of a token this server signed that has not expired, else null. */
export function readLoupeToken(
  token: string,
  secret: string,
  now = Date.now(),
): LoupeClaims | null {
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
    ) as LoupeClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (!parseOwner(claims.owner) || typeof claims.visitor !== "string")
      return null;
    switch (claims.kind) {
      case "guest":
        return claims.owner === `guest:${claims.pass}` ? claims : null;
      case "host":
        return claims.owner.startsWith("host:") ? claims : null;
      case "e2e":
        return claims.owner === "e2e" ? claims : null;
      case "examiner":
        return claims.examinationId && UUID.test(claims.examinationId)
          ? claims
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
