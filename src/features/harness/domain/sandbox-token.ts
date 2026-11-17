import { createHmac } from "node:crypto";

/** What a token can be for; one Runner route accepts exactly one of them. */
export type SandboxAction = "write" | "read" | "list" | "run" | "destroy";

export type SandboxTokenClaims = {
  /** The Session's id (a lower-case UUID). */
  sid: string;
  act: SandboxAction;
  /** Unix seconds. The Runner refuses a token expiring more than 300 s ahead. */
  exp: number;
};

/**
 * The Runner's token (`sandbox-runner/token.mjs`): base64url of the JSON
 * `{"sid","exp","act"}` (that key order), a dot, and base64url of its
 * HMAC-SHA256 under the shared secret. Pure: the caller picks `exp`.
 */
export function signSandboxToken(
  secret: string,
  claims: SandboxTokenClaims,
): string {
  const payload = Buffer.from(
    JSON.stringify({ sid: claims.sid, exp: claims.exp, act: claims.act }),
    "utf8",
  );
  const mac = createHmac("sha256", secret).update(payload).digest();
  return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
}
