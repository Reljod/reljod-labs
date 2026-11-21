import "server-only";
import { headers } from "next/headers";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";
import { LimitError } from "./errors";

/** Who is spending: a salted hash of the IP, never an Owner. */
export type Visitor = { hash: string; trusted: boolean };

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass)
    return { hash: "e2e", trusted: true };
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

type Kind = "walk" | "ask" | "upload";

const CAPS: Record<
  Kind,
  { hour: number; day: number; hourWords: string; dayWords: string }
> = {
  walk: {
    hour: LIMITS.walksPerHour,
    day: LIMITS.walksPerDay,
    hourWords: `That's ${LIMITS.walksPerHour} Walks this hour. Replay a recorded one, or come back soon.`,
    dayWords:
      "Floorwalk has walked all it may today. The recorded Walks still play.",
  },
  ask: {
    hour: LIMITS.asksPerHour,
    day: LIMITS.asksPerDay,
    hourWords: `That's ${LIMITS.asksPerHour} questions this hour. Try again soon.`,
    dayWords: "Floorwalk has answered all it may today.",
  },
  upload: {
    hour: LIMITS.uploadsPerHour,
    day: LIMITS.walksPerDay,
    hourWords: `That's ${LIMITS.uploadsPerHour} uploads this hour.`,
    dayWords: "No more uploads today.",
  },
};

/**
 * Counts one paid call against the visitor's hour and everyone's day, or
 * throws a LimitError. Taken before the model is called. The advisory lock
 * keeps two requests at once from both taking the last place; old rows go
 * on the way.
 */
export async function take(kind: Kind, who: Visitor) {
  if (who.trusted) return;
  const cap = CAPS[kind];
  const verdict = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`floorwalk:${kind}`}, 0))`;
    await tx`delete from floorwalk.rate_hits where created_at < now() - interval '1 day'`;
    const [row] = await tx<{ hour: number; day: number }[]>`
      select
        count(*) filter (
          where visitor_hash = ${who.hash} and created_at > now() - interval '1 hour'
        )::int as hour,
        count(*)::int as day
      from floorwalk.rate_hits
      where kind = ${kind}`;
    if ((row?.hour ?? 0) >= cap.hour) return "hour" as const;
    if ((row?.day ?? 0) >= cap.day) return "day" as const;
    await tx`insert into floorwalk.rate_hits (visitor_hash, kind) values (${who.hash}, ${kind})`;
    return "taken" as const;
  });
  if (verdict === "hour") throw new LimitError(cap.hourWords);
  if (verdict === "day") throw new LimitError(cap.dayWords);
}

/** How many Walks and Asks the visitor has started this hour. */
export async function used(
  who: Visitor,
): Promise<{ walks: number; asks: number }> {
  if (who.trusted) return { walks: 0, asks: 0 };
  const [row] = await sql()<{ walks: number; asks: number }[]>`
    select
      count(*) filter (where kind = 'walk')::int as walks,
      count(*) filter (where kind = 'ask')::int as asks
    from floorwalk.rate_hits
    where visitor_hash = ${who.hash}
      and created_at > now() - interval '1 hour'`;
  return { walks: row?.walks ?? 0, asks: row?.asks ?? 0 };
}
