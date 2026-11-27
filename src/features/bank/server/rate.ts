import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { LimitError } from "../core/errors";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";

/** Who is spending: a salted hash of the IP, never an Owner (rate limits stay on the visitor hash). */
export type Visitor = { hash: string; trusted: boolean };

export { E2E_VISITOR };

/**
 * Whether a header carries the e2e bypass token, compared in constant time
 * (never with `===`). With no token configured, nothing passes. The same
 * check as `isE2eToken` in `@/features/access/server/e2e`; switch to that
 * one once it is on this branch.
 */
export function isE2eToken(
  given: string | null | undefined,
  expected: string = env.e2eBypassToken(),
): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  if (isE2eToken(requestHeaders.get(E2E_HEADER))) {
    return { hash: E2E_VISITOR, trusted: true };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

const RATES = {
  message: {
    perHour: LIMITS.messagesPerHour,
    refusal: (limit: number) =>
      `That's ${limit} messages this hour. Try again soon.`,
  },
  write: {
    perHour: LIMITS.writesPerHour,
    refusal: (limit: number) =>
      `That's ${limit} changes this hour. Try again soon.`,
  },
  sandbox: {
    perHour: LIMITS.sandboxRunsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Sandbox runs this hour. Try again soon.`,
  },
} as const;

export type RateKind = keyof typeof RATES;

/**
 * Counts one unit of capped work against the visitor, or throws a LimitError
 * when this hour's allowance is used up. Called in the server function, at
 * every entry point: the app, the chat and the MCP server. The count and the
 * insert run under an advisory lock on (visitor, kind), so two requests at
 * once cannot both take the last place.
 */
export async function takeRate(
  who: Visitor,
  owner: Owner,
  kind: RateKind,
): Promise<void> {
  if (who.trusted) return;
  const rate = RATES[kind];
  const taken = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`bank:${who.hash}:${kind}`}, 0))`;
    const [row] = await tx<{ taken: boolean }[]>`
      with recent as (
        select count(*) as used from bank.rate_hits
        where visitor_hash = ${who.hash} and kind = ${kind}
          and created_at > now() - interval '1 hour'
      ),
      hit as (
        insert into bank.rate_hits (owner, visitor_hash, kind)
        select ${owner}, ${who.hash}, ${kind}
        where (select used from recent) < ${rate.perHour}
        returning id
      )
      select exists (select 1 from hit) as taken`;
    return row?.taken ?? false;
  });
  if (!taken) throw new LimitError(rate.refusal(rate.perHour));
}
