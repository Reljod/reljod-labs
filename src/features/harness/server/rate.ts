import "server-only";
import { headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { LIMITS } from "../domain/limits";
import { sql } from "./db";
import { env } from "./env";
import { LimitError } from "./errors";

/** Visitors tagged this way (the e2e suite) skip limits. */
export const TRUSTED_VISITOR = "e2e";

/** Who is spending: a salted hash of the IP, never an Owner (AGENTS.md: rate limits stay on the visitor hash). */
export type Visitor = { hash: string; trusted: boolean };

/** The visitor of the current request, hashed with the site's shared helper. */
export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass) {
    return { hash: TRUSTED_VISITOR, trusted: true };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

/** The kinds of capped work, each with its hourly limit and what to say when it is reached. */
const RATES = {
  message: {
    perHour: LIMITS.messagesPerHour,
    refusal: (limit: number) =>
      `That's ${limit} messages this hour. Try again soon.`,
  },
  run: {
    perHour: LIMITS.runsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Runs this hour. Try again soon.`,
  },
  source: {
    perHour: LIMITS.sourcesPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Sources this hour. Try again soon.`,
  },
  sandbox_command: {
    perHour: LIMITS.sandboxCommandsPerHour,
    refusal: (limit: number) =>
      `That's ${limit} Sandbox commands this hour. Try again soon.`,
  },
} as const;

export type RateKind = keyof typeof RATES;

/**
 * Counts one unit of capped work against the visitor, or throws a LimitError
 * when this hour's allowance is used up. Call it in the server function that
 * does the work, at every entry point that can add it: the app, the chat and
 * the MCP server (conventions.md, "Cap paid work at every entry point").
 * The count and the new row are one statement, so two requests at once
 * cannot both take the last place.
 */
export async function takeRate(
  who: Visitor,
  owner: Owner,
  kind: RateKind,
): Promise<void> {
  if (who.trusted) return;
  const rate = RATES[kind];
  const [row] = await sql()<{ taken: boolean }[]>`
    with recent as (
      select count(*) as used
      from harness.rate_hits
      where visitor_hash = ${who.hash}
        and kind = ${kind}
        and created_at > now() - interval '1 hour'
    ),
    hit as (
      insert into harness.rate_hits (owner, visitor_hash, kind)
      select ${owner}, ${who.hash}, ${kind}
      where (select used from recent) < ${rate.perHour}
      returning id
    )
    select exists (select 1 from hit) as taken`;
  if (!row?.taken) throw new LimitError(rate.refusal(rate.perHour));
}

/** How much of this hour's allowance the visitor has used, for showing it. */
export async function rateUsed(who: Visitor, kind: RateKind) {
  const [row] = await sql()<{ used: number }[]>`
    select count(*)::int as used
    from harness.rate_hits
    where visitor_hash = ${who.hash}
      and kind = ${kind}
      and created_at > now() - interval '1 hour'`;
  return { used: row?.used ?? 0, perHour: RATES[kind].perHour };
}
