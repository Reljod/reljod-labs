import "server-only";
import { headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";
import { LimitError } from "./errors";

export const TRUSTED_VISITOR = "e2e";

/** Who is spending: a salted hash of the IP, never an Owner. */
export type Visitor = { hash: string; trusted: boolean };

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass)
    return { hash: TRUSTED_VISITOR, trusted: true };
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

const RATES = {
  call: {
    perHour: LIMITS.callsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Calls this hour. Try again soon.`,
  },
  turn: {
    perHour: LIMITS.turnsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Turns and tool calls this hour. Try again soon.`,
  },
  supervisor: {
    perHour: LIMITS.supervisorQuestionsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Supervisor questions this hour. Try again soon.`,
  },
  sandbox: {
    perHour: LIMITS.sandboxRunsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Sandbox runs this hour. Try again soon.`,
  },
} as const;

export type RateKind = keyof typeof RATES;

/**
 * Counts one unit of capped work against the visitor, or throws a LimitError.
 * Called in the server function that does the work, at every entry point
 * (the app, the Session's tool bridge, the MCP server). The advisory lock
 * keeps two requests at once from both taking the last place.
 */
export async function takeRate(who: Visitor, owner: Owner, kind: RateKind) {
  if (who.trusted) return;
  const rate = RATES[kind];
  const taken = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`swb:${who.hash}:${kind}`}, 0))`;
    const [row] = await tx<{ taken: boolean }[]>`
      with recent as (
        select count(*) as used
        from switchboard.rate_hits
        where visitor_hash = ${who.hash}
          and kind = ${kind}
          and created_at > now() - interval '1 hour'
      ),
      hit as (
        insert into switchboard.rate_hits (owner, visitor_hash, kind)
        select ${owner}, ${who.hash}, ${kind}
        where (select used from recent) < ${rate.perHour}
        returning id
      )
      select exists (select 1 from hit) as taken`;
    return row?.taken ?? false;
  });
  if (!taken) throw new LimitError(rate.refusal(rate.perHour));
}

/** This hour's use of every cap, for showing it. */
export async function ratesUsed(who: Visitor) {
  const rows = await sql()<{ kind: RateKind; used: number }[]>`
    select kind, count(*)::int as used
    from switchboard.rate_hits
    where visitor_hash = ${who.hash}
      and created_at > now() - interval '1 hour'
    group by kind`;
  const out = {} as Record<RateKind, { used: number; perHour: number }>;
  for (const kind of Object.keys(RATES) as RateKind[])
    out[kind] = {
      used: rows.find((row) => row.kind === kind)?.used ?? 0,
      perHour: RATES[kind].perHour,
    };
  return out;
}
