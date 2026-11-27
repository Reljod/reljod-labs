import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison of two secrets, length first. */
export function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Whether a request header carries `E2E_BYPASS_TOKEN`. Every check that lets
 * the Playwright suite skip a gate, a rate limit or a model goes through this,
 * so none of them compares the secret with `===`. With no token configured,
 * nothing passes.
 */
export function isE2eToken(given: string | null | undefined) {
  const expected = process.env.E2E_BYPASS_TOKEN ?? "";
  if (!expected || !given) return false;
  return sameSecret(given, expected);
}
