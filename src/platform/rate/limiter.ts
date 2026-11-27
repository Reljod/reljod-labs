import "server-only";
import type postgres from "postgres";
import type { Owner } from "@/features/access/domain/owner";
import { type Pool, db as sharedDb } from "@/server/postgres";
import { LimitError } from "../errors";
import type { Visitor } from "../request/visitor";

/**
 * A ceiling on paid work. `visitor` counts one visitor's hits, `everyone`
 * the whole demo's; the window is the last hour or day. `message` is what
 * the visitor is told when it refuses.
 */
export type Cap<K extends string = never> = {
  scope: "visitor" | "everyone";
  window: "hour" | "day";
  max: number;
  message: string;
  /**
   * Kinds counted together against this cap (Prism's one daily ceiling for
   * all its kinds); just the kind being taken when left out.
   */
  across?: readonly K[];
};

/** The contract every feature's rate limits are reached through, so services can be tested without a database. */
export interface RateLimiter<K extends string> {
  /**
   * Counts `units` (1 unless said) against every cap of `kind`, or throws a
   * LimitError naming the first cap it would pass. All caps are checked
   * before anything is recorded, so a refusal spends nothing. The e2e suite
   * (a trusted visitor) is never limited.
   */
  take(
    kind: K,
    who: Visitor,
    options?: { units?: number; owner?: Owner },
  ): Promise<void>;
  /** Units the visitor has used of each kind in the last hour. */
  used(who: Visitor, kinds: readonly K[]): Promise<Record<K, number>>;
}

type Config<K extends string> = {
  /** `<schema>.rate_hits`: `visitor_hash`, the kind column, `created_at`. */
  table: `${string}.rate_hits`;
  /** The column naming what was spent (`kind`, or Helio's `bucket`). */
  kindColumn?: "kind" | "bucket";
  /** The table has a `units` column (Prism, Helio); otherwise one row is one unit. */
  units?: boolean;
  /** The table has an `owner` column (a workspace foreign key) that must be filled. */
  owner?: boolean;
  caps: Record<K, readonly Cap<K>[]>;
  /** The pool; the shared one unless a test gives its own. */
  db?: () => Pool;
};

/**
 * Old hits are deleted on about one take in `SWEEP_EVERY`, not on every one:
 * the sweep is a write and a scan, and the windows only ever look back a day.
 */
const SWEEP_EVERY = 25;

/**
 * Rate limits in Postgres (never process memory: Vercel runs many instances).
 * The count and the insert run in one transaction under an advisory lock per
 * kind, so two requests at once can never both take the last place
 * (`docs/engineering/conventions.md`, "A rate limit lives in the database").
 * One query counts every window and scope together.
 */
export function pgRateLimiter<K extends string>(
  config: Config<K>,
): RateLimiter<K> {
  const pool = config.db ?? sharedDb;
  const kindColumn = config.kindColumn ?? "kind";
  const schema = config.table.split(".")[0];
  return {
    async take(kind, who, options = {}) {
      if (who.trusted) return;
      const caps = config.caps[kind];
      const units = Math.max(1, Math.floor(options.units ?? 1));
      // Requests that could take the same last place queue on one lock:
      // every kind that shares a cap together, a kind with an everyone-cap
      // per kind, and otherwise only one visitor's requests of that kind.
      const lock = caps.some((cap) => cap.across)
        ? `${schema}:*`
        : caps.some((cap) => cap.scope === "everyone")
          ? `${schema}:${kind}`
          : `${schema}:${kind}:${who.hash}`;
      const kindsOf = (cap: Cap<K>) => cap.across ?? [kind];
      const counted = [...new Set(caps.flatMap(kindsOf))] as string[];
      const refusal = await pool().begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
        if (Math.random() * SWEEP_EVERY < 1)
          await tx`delete from ${tx(config.table)} where created_at < now() - interval '1 day'`;
        const amount = (cap: Cap<K>) => {
          const where = tx`${tx(kindColumn)} in ${tx([...kindsOf(cap)] as string[])}
            ${cap.scope === "visitor" ? tx`and visitor_hash = ${who.hash}` : tx``}
            ${cap.window === "hour" ? tx`and created_at > now() - interval '1 hour'` : tx``}`;
          return config.units
            ? tx`coalesce(sum(units) filter (where ${where}), 0)::int`
            : tx`(count(*) filter (where ${where}))::int`;
        };
        // One query counts every cap: a column per cap.
        const columns = () =>
          caps
            .map((cap, index) => tx`${amount(cap)} as ${tx(`c${index}`)}`)
            .reduce((all, column) => tx`${all}, ${column}`);
        const [row] = caps.length
          ? await tx<Record<string, number>[]>`
              select ${columns()}
              from ${tx(config.table)}
              where ${tx(kindColumn)} in ${tx(counted)} and created_at > now() - interval '1 day'`
          : [];
        const over = caps.find(
          (cap, index) => (row?.[`c${index}`] ?? 0) + units > cap.max,
        );
        if (over) return over.message;
        const hit: Record<string, unknown> = {
          visitor_hash: who.hash,
          [kindColumn]: kind,
        };
        if (config.units) hit.units = units;
        if (config.owner) hit.owner = options.owner ?? null;
        await tx`insert into ${tx(config.table)} ${tx(hit)}`;
        return null;
      });
      if (refusal) throw new LimitError(refusal);
    },

    async used(who, kinds) {
      const zero = Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<
        K,
        number
      >;
      if (who.trusted || kinds.length === 0) return zero;
      const sql = pool();
      const amount = config.units
        ? sql`coalesce(sum(units), 0)`
        : sql`count(*)`;
      const rows = await sql<{ kind: K; used: number }[]>`
        select ${sql(kindColumn)} as kind, (${amount})::int as used
        from ${sql(config.table)}
        where visitor_hash = ${who.hash}
          and created_at > now() - interval '1 hour'
          and ${sql(kindColumn)} in ${sql(kinds as readonly string[] as string[])}
        group by 1`;
      for (const row of rows) zero[row.kind] = row.used;
      return zero;
    },
  };
}

/** A limiter that never refuses: for unit tests and stubbed containers. */
export const unlimited = <K extends string>(): RateLimiter<K> => ({
  take: async () => {},
  used: async (_who, kinds) =>
    Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<K, number>,
});
