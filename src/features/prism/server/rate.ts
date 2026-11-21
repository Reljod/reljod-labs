import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";
import { LimitError } from "./errors";

export const STUB_HEADER = "x-prism-stub";

export interface Visitor {
  readonly hash: string;
  readonly trusted: boolean;
  readonly stubbed: boolean;
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve visitor identity (salted IP hash) and trusted E2E / stub flags. */
export async function visitor(): Promise<Visitor> {
  const reqHeaders = await headers();
  const bypass = env.e2eBypassToken();
  const given = reqHeaders.get(E2E_HEADER);
  if (bypass && given && sameSecret(given, bypass)) {
    return {
      hash: "e2e",
      trusted: true,
      stubbed: reqHeaders.get(STUB_HEADER) === "1",
    };
  }
  const ip =
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    reqHeaders.get("x-real-ip") ??
    "unknown";
  return {
    hash: hashVisitor(ip, env.rateLimitSalt()),
    trusted: false,
    stubbed: false,
  };
}

const RATES = {
  refract: {
    perHour: LIMITS.refractionsPerHour,
    refusal: (n: number) =>
      `That's ${n} refractions this hour. Try again in a bit.`,
  },
  tribunal: {
    perHour: LIMITS.tribunalCallsPerHour,
    refusal: (n: number) =>
      `That's ${n} tribunal model calls this hour. Try again in a bit.`,
  },
  cascade: {
    perHour: LIMITS.cascadeCallsPerHour,
    refusal: (n: number) =>
      `That's ${n} cascade model calls this hour. Try again in a bit.`,
  },
} as const;

export type RateKind = keyof typeof RATES;

/**
 * Counts `units` Decision Model calls against the visitor in Postgres under a
 * transaction-scoped advisory lock, or throws LimitError when this hour's
 * allowance would be exceeded. Awaited BEFORE the first model call at every
 * entry point so concurrent serverless instances share one durable cap.
 */
export async function takeRate(
  who: Visitor,
  owner: Owner,
  kind: RateKind,
  units = 1,
): Promise<void> {
  if (who.trusted) return;
  const count = Math.max(1, Math.trunc(units));
  const rate = RATES[kind];
  const taken = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`prism:${who.hash}:${kind}`}, 0))`;
    const [row] = await tx<{ taken: boolean }[]>`
      with recent as (
        select coalesce(sum(units), 0)::int as used
        from prism.rate_hits
        where visitor_hash = ${who.hash}
          and kind = ${kind}
          and created_at > now() - interval '1 hour'
      ),
      hit as (
        insert into prism.rate_hits (owner, visitor_hash, kind, units)
        select ${owner}, ${who.hash}, ${kind}, ${count}
        where (select used from recent) + ${count} <= ${rate.perHour}
        returning id
      )
      select exists (select 1 from hit) as taken`;
    return row?.taken ?? false;
  });
  if (!taken) throw new LimitError(rate.refusal(rate.perHour));
}
