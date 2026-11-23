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

export type Spend = "turn" | "debrief";

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

const CAPS: Record<Spend, { hour: number; day: number }> = {
  turn: { hour: LIMITS.turnsPerHour, day: LIMITS.turnsPerDay },
  debrief: { hour: LIMITS.debriefsPerHour, day: LIMITS.debriefsPerDay },
};

/**
 * Counts one Turn or Debrief against the visitor's hour and everyone's day,
 * or throws a LimitError. Taken before any model call. The advisory lock
 * keeps two requests at once from both taking the last place; rows older than
 * a day go on the way.
 */
export async function take(who: Visitor, kind: Spend) {
  if (who.trusted) return;
  const cap = CAPS[kind];
  const verdict = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`firebreak:${kind}`}, 0))`;
    await tx`delete from firebreak.rate_hits where created_at < now() - interval '1 day'`;
    const [row] = await tx<{ hour: number; day: number }[]>`
      select
        count(*) filter (
          where visitor_hash = ${who.hash} and created_at > now() - interval '1 hour'
        )::int as hour,
        count(*)::int as day
      from firebreak.rate_hits
      where kind = ${kind}`;
    if ((row?.hour ?? 0) >= cap.hour) return "hour" as const;
    if ((row?.day ?? 0) >= cap.day) return "day" as const;
    await tx`insert into firebreak.rate_hits (visitor_hash, kind) values (${who.hash}, ${kind})`;
    return "taken" as const;
  });
  if (verdict === "hour")
    throw new LimitError(
      kind === "turn"
        ? `That's ${cap.hour} Rounds this hour. Take a breath and come back soon.`
        : `That's ${cap.hour} Reviews this hour. Come back soon.`,
    );
  if (verdict === "day")
    throw new LimitError(
      "The Room has sat all it may today. Come back tomorrow.",
    );
}

/** How many Rounds the visitor has played this hour. */
export async function turnsUsed(who: Visitor): Promise<number> {
  if (who.trusted) return 0;
  const [row] = await sql()<{ used: number }[]>`
    select count(*)::int as used
    from firebreak.rate_hits
    where visitor_hash = ${who.hash}
      and kind = 'turn'
      and created_at > now() - interval '1 hour'`;
  return row?.used ?? 0;
}
