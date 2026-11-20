import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { LIMITS } from "../domain/limits";
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
    perHour: LIMITS.tribunalsPerHour,
    refusal: (n: number) =>
      `That's ${n} tribunals this hour. Try again in a bit.`,
  },
  cascade: {
    perHour: LIMITS.cascadesPerHour,
    refusal: (n: number) =>
      `That's ${n} cascades this hour. Try again in a bit.`,
  },
} as const;

export type RateKind = keyof typeof RATES;

const HOUR_MS = 60 * 60 * 1000;
const MAX_BUCKETS = 2_000;
const hits = new Map<string, number[]>();

/**
 * In-process sliding-window hourly rate limiter keyed on the visitor's salted
 * IP hash. Taken BEFORE the first model call at every entry point.
 */
export function takeRate(who: Visitor, kind: RateKind): void {
  if (who.trusted) return;
  const now = Date.now();
  const cutoff = now - HOUR_MS;
  const key = `${kind}:${who.hash}`;
  const existing = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
  const rule = RATES[kind];
  if (existing.length >= rule.perHour) {
    hits.set(key, existing);
    throw new LimitError(rule.refusal(rule.perHour));
  }
  existing.push(now);
  hits.set(key, existing);
  // Prune stale buckets if the map grows large.
  if (hits.size > MAX_BUCKETS) {
    for (const [bucketKey, timestamps] of hits) {
      const fresh = timestamps.filter((ts) => ts > cutoff);
      if (fresh.length === 0) hits.delete(bucketKey);
      else hits.set(bucketKey, fresh);
    }
  }
}
