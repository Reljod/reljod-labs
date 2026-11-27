import "server-only";
import { createHash, createHmac } from "node:crypto";
import { sameSecret } from "./e2e";
import { env } from "./env";
import type { Access } from "./gate";

/**
 * The proxy has already worked out a request's Access (a JWT check, and for a
 * Host a call to the Auth server, for a Guest a Guest pass read). It hands
 * the answer to the page or route it lets through in this request header, so
 * the second gate does not pay for the same lookups again.
 *
 * The header is internal: the proxy deletes whatever the browser sent under
 * this name and sets its own; it never reaches a response. It is signed with
 * a key derived from `RATE_LIMIT_SALT` and lives for `TTL_MS`, so a forged or
 * replayed value is refused and the gate does the full check instead.
 */
export const FORWARDED_ACCESS_HEADER = "x-labs-access";

const TTL_MS = 30_000;

let key: Buffer | undefined;
function signingKey() {
  key ??= createHash("sha256")
    .update(`labs:forwarded-access:${env.rateLimitSalt()}`)
    .digest();
  return key;
}

function sign(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** The signed header value for an Access, minted by the proxy. */
export function forwardAccess(access: Access, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ access, exp: now + TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * The Access the proxy forwarded, or undefined when the header is missing,
 * forged, malformed or expired (the caller then checks from scratch).
 */
export function forwardedAccess(
  value: string | null | undefined,
  at?: number,
): Access | undefined {
  if (!value) return undefined;
  // The wall clock through `performance`: Next refuses `Date.now()` in a
  // render before its first uncached read, and this runs at the gate.
  const now = at ?? performance.timeOrigin + performance.now();
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !signature || rest.length > 0) return undefined;
  if (!sameSecret(signature, sign(payload))) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      access?: Access;
      exp?: number;
    };
    if (typeof parsed.exp !== "number" || parsed.exp < now) return undefined;
    const kind = parsed.access?.kind;
    return kind === "host" || kind === "guest" || kind === "e2e"
      ? parsed.access
      : undefined;
  } catch {
    return undefined;
  }
}
