import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a request carries `Authorization: Bearer <secret>`. Compared in
 * constant time (as digests, so the length does not leak either). An empty
 * secret refuses everyone: a cron route fails closed until CRON_SECRET is set.
 */
export function cronAuthorized(header: string | null, secret: string) {
  if (!secret || !header) return false;
  const given = createHash("sha256").update(header).digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}
