import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  applyRuleEdits,
  DEFAULT_RULEBOOK_VERSION,
  defaultRulebook,
  normaliseRulebook,
  type RuleEdit,
  type Rulebook,
  ruleDef,
} from "../domain/rules";
import type { Caller } from "./caller";
import { catalogFor } from "./catalog";
import { jsonb, sql } from "./db";
import { RuleEditRefused } from "./errors";
import { trailIn } from "./trail";

export type RulebookVersion = {
  version: number;
  rulebook: Rulebook;
  changed: string[];
  savedAt: string | null;
};

/** The Owner's Rulebook now: their latest Version, or the Defaults (Version 0) if they never edited. */
export async function currentRulebook(owner: Owner): Promise<RulebookVersion> {
  const [row] = await sql()<
    { version: number; rules: unknown; changed: string[]; created_at: Date }[]
  >`
    select version, rules, changed, created_at
    from canvas.rulebooks
    where owner = ${owner}
    order by version desc
    limit 1`;
  if (!row)
    return {
      version: DEFAULT_RULEBOOK_VERSION,
      rulebook: defaultRulebook(),
      changed: [],
      savedAt: null,
    };
  return {
    version: row.version,
    rulebook: normaliseRulebook(row.rules),
    changed: row.changed,
    savedAt: row.created_at.toISOString(),
  };
}

/** Every saved Version, newest first, for the Rules place. */
export async function rulebookHistory(owner: Owner) {
  const rows = await sql()<
    { version: number; changed: string[]; created_at: Date }[]
  >`
    select version, changed, created_at
    from canvas.rulebooks
    where owner = ${owner}
    order by version desc
    limit 50`;
  return rows.map((row) => ({
    version: row.version,
    changed: row.changed,
    savedAt: row.created_at.toISOString(),
  }));
}

/**
 * Saves Rule edits as a new Version of the Owner's Rulebook, with its Trail
 * event in the same transaction. A bad value is refused where it was made; an
 * edit that changes nothing saves nothing.
 */
export async function saveRules(
  caller: Caller,
  edits: RuleEdit[],
): Promise<RulebookVersion> {
  const [current, catalog] = await Promise.all([
    currentRulebook(caller.owner),
    catalogFor(caller.owner),
  ]);
  const applied = applyRuleEdits(current.rulebook, edits, {
    tables: catalog.guard.tables,
  });
  if (applied.errors.length > 0) throw new RuleEditRefused(applied.errors);
  if (applied.changed.length === 0) return current;
  return sql().begin(async (tx) => {
    // One Version at a time per Owner, so two saves cannot take the same number.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`canvas:rules:${caller.owner}`}, 0))`;
    const [latest] = await tx<{ version: number }[]>`
      select coalesce(max(version), 0)::int as version
      from canvas.rulebooks where owner = ${caller.owner}`;
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx<{ created_at: Date }[]>`
      insert into canvas.rulebooks (owner, version, rules, changed)
      values (${caller.owner}, ${version}, ${jsonb(tx, applied.rulebook)}, ${applied.changed})
      returning created_at`;
    await trailIn(tx, caller, {
      action: "rules.saved",
      summary: `Saved Rulebook v${version}: ${applied.changed
        .map((id) => ruleDef(id)?.title ?? id)
        .join("; ")}`,
      detail: {
        version,
        changed: applied.changed,
        rules: Object.fromEntries(
          applied.changed.map((id) => [id, applied.rulebook[id]]),
        ),
      },
    });
    return {
      version,
      rulebook: applied.rulebook,
      changed: applied.changed,
      savedAt: row.created_at.toISOString(),
    };
  });
}
