import "server-only";
import { headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { isE2eToken } from "@/features/access/server/e2e";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";
import { LimitError } from "./errors";

/** Visitors tagged this way (the e2e suite) skip hourly limits. */
export const TRUSTED_VISITOR = "e2e";

/** Who is spending: a salted hash of the IP, never an Owner (AGENTS.md). */
export type Visitor = { hash: string; trusted: boolean };

/** The visitor of the current request. */
export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  if (isE2eToken(requestHeaders.get(E2E_HEADER)))
    return { hash: TRUSTED_VISITOR, trusted: true };
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

const RATES = {
  question: {
    perHour: LIMITS.questionsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Questions this hour. Try again soon.`,
  },
  run: {
    perHour: LIMITS.runsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Runs this hour. Try again soon.`,
  },
  refresh: {
    perHour: LIMITS.refreshesPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Refreshes this hour. Try again soon.`,
  },
  upload: {
    perHour: LIMITS.uploadsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Uploads this hour. Try again soon.`,
  },
} as const;

export type RateKind = keyof typeof RATES;

/**
 * Counts one unit of capped work against the visitor, or throws a LimitError
 * when this hour's allowance is used up. Called in the server function that
 * does the work, so the page, the chat and the MCP server share one count.
 * The count and the insert run under a transaction-scoped advisory lock, so
 * two requests at once cannot both take the last place.
 */
export async function takeRate(
  who: Visitor,
  owner: Owner,
  kind: RateKind,
): Promise<void> {
  if (who.trusted) return;
  const rate = RATES[kind];
  const taken = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`canvas:${who.hash}:${kind}`}, 0))`;
    const [row] = await tx<{ taken: boolean }[]>`
      with recent as (
        select count(*) as used
        from canvas.rate_hits
        where visitor_hash = ${who.hash}
          and kind = ${kind}
          and created_at > now() - interval '1 hour'
      ),
      hit as (
        insert into canvas.rate_hits (owner, visitor_hash, kind)
        select ${owner}, ${who.hash}, ${kind}
        where (select used from recent) < ${rate.perHour}
        returning id
      )
      select exists (select 1 from hit) as taken`;
    return row?.taken ?? false;
  });
  if (!taken) throw new LimitError(rate.refusal(rate.perHour));
}
