import "server-only";
import { headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { isE2eToken } from "@/features/access/server/e2e";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { LIMITS, rateVerdict } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";
import { LimitError } from "./errors";

export const STUB_HEADER = "x-prism-stub";

export interface Visitor {
  readonly hash: string;
  readonly trusted: boolean;
  readonly stubbed: boolean;
}

/** Resolve visitor identity (salted IP hash) and trusted E2E / stub flags. */
export async function visitor(): Promise<Visitor> {
  const reqHeaders = await headers();
  if (isE2eToken(reqHeaders.get(E2E_HEADER))) {
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
    refusal: (n: number, left: number) =>
      `That would go over your ${n} refractions this hour (${left} left). Try again in a bit.`,
  },
  tribunal: {
    perHour: LIMITS.tribunalCallsPerHour,
    refusal: (n: number, left: number) =>
      `That would go over your ${n} tribunal model calls this hour (${left} left). Try again in a bit.`,
  },
  cascade: {
    perHour: LIMITS.cascadeCallsPerHour,
    refusal: (n: number, left: number) =>
      `That would go over your ${n} cascade model calls this hour (${left} left). Try again in a bit.`,
  },
} as const;

export type RateKind = keyof typeof RATES;

/**
 * Counts `units` Decision Model calls against the visitor's hour and
 * everyone's day in Postgres under transaction-scoped advisory locks (the
 * visitor's, then the global one), or throws LimitError when either would be
 * exceeded. Awaited BEFORE the first model call at every entry point so
 * concurrent serverless instances share one durable cap.
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
    await tx`select pg_advisory_xact_lock(hashtextextended('prism:all', 0))`;
    const [row] = await tx<{ hour: number; day: number }[]>`
      select
        (select coalesce(sum(units), 0)::int from prism.rate_hits
          where visitor_hash = ${who.hash} and kind = ${kind}
            and created_at > now() - interval '1 hour') as hour,
        (select coalesce(sum(units), 0)::int from prism.rate_hits
          where created_at > now() - interval '1 day') as day`;
    const used = { hour: row?.hour ?? 0, day: row?.day ?? 0 };
    const verdict = rateVerdict({
      units: count,
      perHour: rate.perHour,
      usedHour: used.hour,
      usedDay: used.day,
    });
    if (verdict === "taken")
      await tx`
        insert into prism.rate_hits (owner, visitor_hash, kind, units)
        values (${owner}, ${who.hash}, ${kind}, ${count})`;
    return { verdict, used: used.hour };
  });
  if (taken.verdict === "hour") {
    const left = Math.max(0, rate.perHour - taken.used);
    throw new LimitError(rate.refusal(rate.perHour, left));
  }
  if (taken.verdict === "day")
    throw new LimitError(
      "Prism has made all the decisions it may today. Come back tomorrow.",
    );
}
