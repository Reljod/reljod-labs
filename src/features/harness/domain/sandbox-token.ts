import { createHmac } from "node:crypto";

/** What a token can be for; one Runner route accepts exactly one of them. */
export type SandboxAction =
  | "write"
  | "read"
  | "list"
  | "run"
  | "destroy"
  | "status";

export type SandboxTokenClaims = {
  /** The Session's id (a lower-case UUID); "" for `status`, which names no Session. */
  sid: string;
  act: SandboxAction;
  /** Unix seconds. The Runner refuses a token expiring more than 300 s ahead. */
  exp: number;
  /**
   * The Owner tag (`sandboxOwnerTag`). The Runner caps live Sandboxes per tag
   * and requires it on `write` and `run`, which can start one.
   */
  own?: string;
};

/**
 * The Runner's token (`sandbox-runner/token.mjs`): base64url of the JSON
 * `{"sid","exp","act","own"}` (that key order, `own` only when given), a
 * dot, and base64url of its HMAC-SHA256 under the shared secret. Pure: the
 * caller picks `exp`.
 */
export function signSandboxToken(
  secret: string,
  claims: SandboxTokenClaims,
): string {
  const body: Record<string, unknown> = {
    sid: claims.sid,
    exp: claims.exp,
    act: claims.act,
  };
  if (claims.own !== undefined) body.own = claims.own;
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  const mac = createHmac("sha256", secret).update(payload).digest();
  return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
}

/** Kept apart from token MACs, so a tag can never be mistaken for one. */
const OWNER_TAG_LABEL = "harness-sandbox-owner:";

/**
 * An opaque, stable tag of the Owner for the Runner's per-Owner cap: the
 * first 22 base64url characters (132 bits) of HMAC-SHA256 of the Owner under
 * the shared secret. The Runner never learns who the Owner is.
 */
export function sandboxOwnerTag(secret: string, owner: string): string {
  return createHmac("sha256", secret)
    .update(`${OWNER_TAG_LABEL}${owner}`, "utf8")
    .digest("base64url")
    .slice(0, 22);
}
