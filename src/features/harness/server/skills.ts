import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import type { PipelineSpec } from "../domain/pipeline";
import { pipelineOf } from "../domain/pipelines";
import {
  defaultRuleState,
  type RuleView,
  renderRulebookMd,
} from "../domain/rules";
import {
  SKILL_DEFAULTS,
  type SkillDefault,
  type SkillVersion,
  type SkillView,
  skillView,
} from "../domain/skills";
import { latestOf, nextVersion } from "../domain/skills/versions";
import { auditIn } from "./audit";
import { type Db, sql } from "./db";
import type { SkillRepository } from "./ports";
import { listRules } from "./rules";

/*
 * A Skill's current state is the latest `harness.skill_versions` row for the
 * Owner, else the Default in `SKILL_DEFAULTS`. A save never updates a row: it
 * adds Version n+1. A Rulebook has no stored body: it is rendered from the
 * current Rules with `renderRulebookMd`, so reading a Rulebook always says
 * what a Run enforces. What a save may say is the Skills service's.
 */

type SkillRow = {
  skill_id: string;
  version: number;
  name: string;
  description: string;
  body: string;
  saved_by: string;
  saved_by_name: string;
  note: string | null;
  created_at: Date;
};

const COLUMNS = (db: Db) => db`
  sv.skill_id, sv.version, sv.name, sv.description, sv.body,
  sv.saved_by, st.name as saved_by_name, sv.note, sv.created_at`;

const latestOfRow = (row: SkillRow) => ({
  name: row.name,
  description: row.description,
  body: row.body,
  version: row.version,
  savedBy: { id: row.saved_by, name: row.saved_by_name },
  createdAt: row.created_at.toISOString(),
});

const versionOfRow = (row: SkillRow): SkillVersion => ({
  skillId: row.skill_id,
  version: row.version,
  name: row.name,
  description: row.description,
  body: row.body,
  savedBy: { id: row.saved_by, name: row.saved_by_name },
  note: row.note,
  createdAt: row.created_at.toISOString(),
});

function defaultOf(skillId: string): SkillDefault {
  const base = SKILL_DEFAULTS[skillId];
  if (!base) throw new NotFoundError("There is no such Skill.");
  return base;
}

/** The Pipeline a Rulebook describes; a stand-in with no Steps while the Pipelines are not declared. */
function pipelineFor(
  base: SkillDefault,
): Pick<PipelineSpec, "id" | "title" | "steps"> {
  const found = base.pipelineId ? pipelineOf(base.pipelineId) : null;
  if (found) return found;
  return {
    id: base.pipelineId ?? ("member_request" as const),
    title: base.name,
    steps: [],
  };
}

/** A Rulebook's Rules out of every Rule: its Pipeline's, or all of them when it names none. */
function rulesOf(base: SkillDefault, rules: RuleView[]): RuleView[] {
  return base.pipelineId
    ? rules.filter((rule) => rule.spec.pipelineId === base.pipelineId)
    : rules;
}

/** A Rulebook as the Workspace has it: its body rendered from its current Rules. */
function rulebookView(base: SkillDefault, rules: RuleView[]): SkillView {
  const pipeline = pipelineFor(base);
  const defaults = rules.map((rule) => ({
    spec: rule.spec,
    state: defaultRuleState(rule.spec),
  }));
  const edited = rules.filter((rule) => rule.edited);
  const newest = edited
    .filter((rule) => rule.savedAt)
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""))[0];
  const view = skillView(base, null);
  return {
    ...view,
    body: renderRulebookMd(pipeline, rules),
    // The sum of its Rules' Versions: it rises with every Rule save, so the Plugin's version does too.
    version: rules.reduce((sum, rule) => sum + rule.state.version, 0),
    edited: edited.length > 0,
    savedBy: newest?.savedBy ?? null,
    savedAt: newest?.savedAt ?? null,
    default: { ...view.default, body: renderRulebookMd(pipeline, defaults) },
  };
}

/**
 * Every Skill as the Workspace has it now, Rulebooks included, in Default
 * order. The Skills' Versions and every Rule are two queries that start
 * together, rather than one for the Skills and then one per Rulebook.
 */
export async function listSkills(owner: Owner): Promise<SkillView[]> {
  const db = sql();
  const [rows, rules] = await Promise.all([
    db<SkillRow[]>`
      select distinct on (sv.skill_id) ${COLUMNS(db)}
      from harness.skill_versions sv
      join harness.staff st on st.id = sv.saved_by
      where sv.owner = ${owner}
      order by sv.skill_id, sv.version desc`,
    listRules(owner),
  ]);
  const latest = new Map(rows.map((row) => [row.skill_id, row]));
  return Object.values(SKILL_DEFAULTS).map((base) => {
    if (base.kind === "rulebook")
      return rulebookView(base, rulesOf(base, rules));
    const row = latest.get(base.id);
    return skillView(base, row ? latestOfRow(row) : null);
  });
}

/** One Skill by id, or null when there is no such Skill. The chat's `load_skill` and the MCP server read it here. */
export async function getSkill(
  owner: Owner,
  skillId: string,
): Promise<SkillView | null> {
  const base = SKILL_DEFAULTS[skillId];
  if (!base) return null;
  if (base.kind === "rulebook") {
    return rulebookView(base, await listRules(owner, base.pipelineId ?? null));
  }
  const db = sql();
  const [row] = await db<SkillRow[]>`
    select ${COLUMNS(db)}
    from harness.skill_versions sv
    join harness.staff st on st.id = sv.saved_by
    where sv.owner = ${owner} and sv.skill_id = ${skillId}
    order by sv.version desc
    limit 1`;
  return skillView(base, row ? latestOfRow(row) : null);
}

async function versionRows(db: Db, owner: Owner, skillId: string) {
  return db<SkillRow[]>`
    select ${COLUMNS(db)}
    from harness.skill_versions sv
    join harness.staff st on st.id = sv.saved_by
    where sv.owner = ${owner} and sv.skill_id = ${skillId}
    order by sv.version desc`;
}

export const skillRepository: SkillRepository = {
  list: listSkills,
  get: getSkill,

  /** A Skill's saved Versions, newest first. Empty while only the Default applies (and for a Rulebook, whose history is its Rules'). */
  async history(owner, skillId) {
    const base = defaultOf(skillId);
    if (base.kind === "rulebook") return [];
    const rows = await versionRows(sql(), owner, base.id);
    return rows.map(versionOfRow);
  },

  /**
   * Under the Workspace's lock on the Skill (two saves at once get Versions
   * n+1 and n+2): the saved Versions are read once, the plan decides,
   * Version n+1 and its event go in the same transaction.
   */
  async saveVersion(owner, skillId, staffId, plan) {
    const base = defaultOf(skillId);
    const saved = await sql().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`harness:skill:${owner}:${base.id}`}, 0))`;
      const rows = await versionRows(tx, owner, base.id);
      const latest = latestOf(rows);
      const decided = plan({
        current: latest ?? { ...base, version: 0 },
        versions: rows,
      });
      const version = nextVersion(rows.map((row) => row.version));
      const [row] = await tx<SkillRow[]>`
        with inserted as (
          insert into harness.skill_versions
            (owner, skill_id, version, name, description, body, saved_by, note)
          values (
            ${owner}, ${base.id}, ${version}, ${decided.text.name},
            ${decided.text.description}, ${decided.text.body}, ${staffId},
            ${decided.note}
          )
          returning *
        )
        select sv.skill_id, sv.version, sv.name, sv.description, sv.body,
               sv.saved_by, st.name as saved_by_name, sv.note, sv.created_at
        from inserted sv
        join harness.staff st on st.id = sv.saved_by`;
      if (!row) throw new Error("The Skill Version was not saved.");
      await auditIn(tx, decided.event(version));
      return row;
    });
    return skillView(base, latestOfRow(saved));
  },
};
