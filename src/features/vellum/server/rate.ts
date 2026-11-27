import "server-only";
import { headers } from "next/headers";
import { isE2eToken } from "@/features/access/server/e2e";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { E2E_HEADER } from "@/platform/request/headers";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";
import { LimitError } from "./errors";

/** Who is spending: a salted hash of the IP, never an Owner. */
export type Visitor = { hash: string; trusted: boolean };

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  if (isE2eToken(requestHeaders.get(E2E_HEADER)))
    return { hash: "e2e", trusted: true };
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

/**
 * Counts one Pass against the visitor's hour and everyone's day, or throws a
 * LimitError. Taken before the model is called. The advisory lock keeps two
 * requests at once from both taking the last place; old rows go on the way.
 */
export async function takePass(who: Visitor) {
  if (who.trusted) return;
  const verdict = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('vellum:pass', 0))`;
    await tx`delete from vellum.rate_hits where created_at < now() - interval '1 day'`;
    const [row] = await tx<{ hour: number; day: number }[]>`
      select
        count(*) filter (
          where visitor_hash = ${who.hash} and created_at > now() - interval '1 hour'
        )::int as hour,
        count(*)::int as day
      from vellum.rate_hits
      where kind = 'pass'`;
    if ((row?.hour ?? 0) >= LIMITS.passesPerHour) return "hour" as const;
    if ((row?.day ?? 0) >= LIMITS.passesPerDay) return "day" as const;
    await tx`insert into vellum.rate_hits (visitor_hash, kind) values (${who.hash}, 'pass')`;
    return "taken" as const;
  });
  if (verdict === "hour")
    throw new LimitError(
      `That's ${LIMITS.passesPerHour} Passes this hour. Try again soon.`,
    );
  if (verdict === "day")
    throw new LimitError(
      "Vellum has drawn all it may today. Come back tomorrow.",
    );
}

/** How many Passes the visitor has started this hour. */
export async function passesUsed(who: Visitor): Promise<number> {
  if (who.trusted) return 0;
  const [row] = await sql()<{ used: number }[]>`
    select count(*)::int as used
    from vellum.rate_hits
    where visitor_hash = ${who.hash}
      and kind = 'pass'
      and created_at > now() - interval '1 hour'`;
  return row?.used ?? 0;
}
