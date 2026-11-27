import "server-only";
import { db, jsonb } from "@/server/postgres";
import { normaliseRulebook } from "../domain/rules";
import type { RulebookRepository } from "./ports";
import { iso, trailIn } from "./trail";

/** The Owner's Rulebook Versions in Postgres (`canvas.rulebooks`, keyed by owner and version). */
export const rulebookRepository: RulebookRepository = {
  async latest(owner) {
    const [row] = await db()<
      {
        version: number;
        rules: unknown;
        changed: string[];
        created_at: string;
      }[]
    >`
      select version, rules, changed, created_at
      from canvas.rulebooks
      where owner = ${owner}
      order by version desc
      limit 1`;
    if (!row) return null;
    return {
      version: row.version,
      rulebook: normaliseRulebook(row.rules),
      changed: row.changed,
      savedAt: iso(row.created_at),
    };
  },

  async history(owner, limit) {
    const rows = await db()<
      { version: number; changed: string[]; created_at: string }[]
    >`
      select version, changed, created_at
      from canvas.rulebooks
      where owner = ${owner}
      order by version desc
      limit ${limit}`;
    return rows.map((row) => ({
      version: row.version,
      changed: row.changed,
      savedAt: iso(row.created_at),
    }));
  },

  async save(caller, rulebook, changed, event) {
    return db().begin(async (tx) => {
      // One Version at a time per Owner, so two saves cannot take the same number.
      await tx`select pg_advisory_xact_lock(hashtextextended(${`canvas:rules:${caller.owner}`}, 0))`;
      const [latest] = await tx<{ version: number }[]>`
        select coalesce(max(version), 0)::int as version
        from canvas.rulebooks where owner = ${caller.owner}`;
      const version = (latest?.version ?? 0) + 1;
      const [row] = await tx<{ created_at: string }[]>`
        insert into canvas.rulebooks (owner, version, rules, changed)
        values (${caller.owner}, ${version}, ${jsonb(tx, rulebook)}, ${changed})
        returning created_at`;
      await trailIn(tx, caller, event(version));
      return { version, rulebook, changed, savedAt: iso(row.created_at) };
    });
  },
};
