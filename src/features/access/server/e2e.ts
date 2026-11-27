import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * True when `header` is the configured `E2E_BYPASS_TOKEN`. Compared in
 * constant time over SHA-256 digests, so neither the token's length nor its
 * prefix leaks through timing. Never true when no token is configured.
 */
export function isE2eToken(header: string | null | undefined): boolean {
  const bypass = env.e2eBypassToken();
  if (!bypass || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(bypass).digest();
  return timingSafeEqual(a, b);
}
