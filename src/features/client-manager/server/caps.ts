import "server-only";
import { LimitError } from "@/platform/errors";
import { refusalFor } from "../domain/limits";
import { sql } from "./db";
import type { Caps } from "./ports";
import { usageFor } from "./repository";

/**
 * Client Manager's caps in Postgres. Not `pgRateLimiter`: a place is held by
 * the row it pays for (a Build, a question) and the caps include the day's
 * spend per visitor and per Owner, so the count reads those tables and the
 * insert of the holding row runs in the same locked transaction.
 */
export const pgCaps: Caps = {
  async check(visitor, kind, owner) {
    if (visitor.trusted) return;
    const usage = await usageFor(sql(), { visitorHash: visitor.hash, owner });
    const refusal = refusalFor(kind, usage);
    if (refusal) throw new LimitError(refusal);
  },

  async take(visitor, owner, kind, hold) {
    if (visitor.trusted) return hold(sql());
    const global = kind === "build" ? "build" : "ask";
    // Always in this order (visitor, Owner, global), so two takes never deadlock.
    return (await sql().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`cm:visitor:${visitor.hash}`}, 0))`;
      if (owner)
        await tx`select pg_advisory_xact_lock(hashtextextended(${`cm:owner:${owner}`}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended(${`cm:all:${global}`}, 0))`;
      const usage = await usageFor(tx, { visitorHash: visitor.hash, owner });
      const refusal = refusalFor(kind, usage);
      if (refusal) throw new LimitError(refusal);
      return hold(tx);
    })) as Awaited<ReturnType<typeof hold>>;
  },
};
