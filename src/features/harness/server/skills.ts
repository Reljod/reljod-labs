import "server-only";
import { strToU8, zipSync } from "fflate";
import type { Owner } from "@/features/access/domain/owner";
import type { PipelineSpec } from "../domain/pipeline";
import { pipelineOf } from "../domain/pipelines";
import { PLUGIN_FILENAME, pluginFiles } from "../domain/plugin";
import {
  defaultRuleState,
  type RuleView,
  renderRulebookMd,
} from "../domain/rules";
import {
  SKILL_DEFAULTS,
  type SkillDefault,
  type SkillText,
  type SkillVersion,
  type SkillView,
  sameSkillText,
  skillProblems,
  skillView,
} from "../domain/skills";
import { latestOf, nextVersion, planRestore } from "../domain/skills/versions";
import type { Actor } from "./actor";
import { auditIn } from "./audit";
import { assertCan } from "./context";
import { type Db, sql } from "./db";
import { InvalidError, NotFoundError } from "./errors";
import { listRules } from "./rules";

/*
 * A Skill's current state is the latest `harness.skill_versions` row for the
 * Owner, else the Default in `SKILL_DEFAULTS`. A save never updates a row: it
 * adds Version n+1. A Rulebook has no stored body: it is rendered from the
 * current Rules with `renderRulebookMd`, so reading a Rulebook always says
 * what a Run enforces.
 */

const NOTE_CHARS = 500;

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

function cleanNote(note: string | null | undefined): string | null {
  const text = note?.trim();
  if (!text) return null;
  if (text.length > NOTE_CHARS) {
    throw new InvalidError(`The note is at most ${NOTE_CHARS} characters.`);
  }
  return text;
}

function refuseRulebook(base: SkillDefault) {
  if (base.kind === "rulebook") {
    throw new InvalidError(
      "A Rulebook is edited as Rule cards, not as text. Change its Rules instead.",
    );
  }
}

async function versionRows(db: Db, owner: Owner, skillId: string) {
  return db<SkillRow[]>`
    select ${COLUMNS(db)}
    from harness.skill_versions sv
    join harness.staff st on st.id = sv.saved_by
    where sv.owner = ${owner} and sv.skill_id = ${skillId}
    order by sv.version desc`;
}

/** Inserts Version n+1 under the Skill's lock, so two saves at once get n+1 and n+2. */
async function insertVersion(
  tx: Db,
  input: {
    owner: Owner;
    staffId: string;
    skillId: string;
    text: SkillText;
    note: string | null;
  },
): Promise<SkillRow> {
  const [top] = await tx<{ top: number }[]>`
    select coalesce(max(version), 0)::int as top
    from harness.skill_versions
    where owner = ${input.owner} and skill_id = ${input.skillId}`;
  const version = nextVersion([top?.top ?? 0]);
  await tx`
    insert into harness.skill_versions
      (owner, skill_id, version, name, description, body, saved_by, note)
    values (
      ${input.owner}, ${input.skillId}, ${version}, ${input.text.name},
      ${input.text.description}, ${input.text.body}, ${input.staffId}, ${input.note}
    )`;
  const row = (await versionRows(tx, input.owner, input.skillId)).find(
    (candidate) => candidate.version === version,
  );
  if (!row) throw new Error("The Skill Version was not saved.");
  return row;
}

const lock = (tx: Db, owner: Owner, skillId: string) =>
  tx`select pg_advisory_xact_lock(hashtextextended(${`harness:skill:${owner}:${skillId}`}, 0))`;

/**
 * Saves an edit as the Skill's next Version. Needs `skill.edit`. A Rulebook
 * is refused (it is edited as Rule cards); so is text `skillProblems`
 * finds, and text that is the same as now. The Audit event is written in the
 * same transaction.
 */
export async function saveSkill(
  input: Actor & { skillId: string; text: SkillText; note?: string | null },
): Promise<SkillView> {
  assertCan(input.staff, "skill.edit");
  const base = defaultOf(input.skillId);
  refuseRulebook(base);
  const text: SkillText = {
    name: input.text.name.trim(),
    description: input.text.description.trim(),
    body: input.text.body.replace(/\r\n/g, "\n"),
  };
  const problems = skillProblems(text);
  if (problems.length > 0) throw new InvalidError(problems[0]?.message ?? "");
  const note = cleanNote(input.note);
  const row = await sql().begin(async (tx) => {
    await lock(tx, input.owner, base.id);
    const rows = await versionRows(tx, input.owner, base.id);
    const latest = latestOf(rows);
    const current: SkillText = latest ?? base;
    if (sameSkillText(current, text)) {
      throw new InvalidError("Nothing changed: the Skill already says that.");
    }
    const saved = await insertVersion(tx, {
      owner: input.owner,
      staffId: input.staff.id,
      skillId: base.id,
      text,
      note,
    });
    await auditIn(tx, {
      owner: input.owner,
      actor: { kind: "staff", staff: input.staff },
      action: "skill.saved",
      summary: `Saved Skill ${base.id} as Version ${saved.version}`,
      target: { kind: "skill", id: base.id },
      detail: {
        version: saved.version,
        previousVersion: latest?.version ?? 0,
        nameChanged: current.name !== text.name,
        descriptionChanged: current.description !== text.description,
        bodyChars: [current.body.length, text.body.length],
        note,
      },
    });
    return saved;
  });
  return skillView(base, latestOfRow(row));
}

/**
 * Puts a Skill back to its Default (`version` left out or 0) or to an
 * earlier Version, by saving that text as a new Version. Needs `skill.edit`.
 */
export async function restoreSkill(
  input: Actor & { skillId: string; version?: number | null },
): Promise<SkillView> {
  assertCan(input.staff, "skill.edit");
  const base = defaultOf(input.skillId);
  refuseRulebook(base);
  const row = await sql().begin(async (tx) => {
    await lock(tx, input.owner, base.id);
    const rows = await versionRows(tx, input.owner, base.id);
    const latest = latestOf(rows);
    const current: SkillText = latest ?? base;
    const plan = planRestore<SkillText>(
      { name: base.name, description: base.description, body: base.body },
      rows,
      input.version,
    );
    if (!plan) throw new NotFoundError("That Version was never saved.");
    if (sameSkillText(current, plan.state)) {
      throw new InvalidError(
        plan.from === null
          ? "The Skill already says what the Default says."
          : `The Skill already says what Version ${plan.from} says.`,
      );
    }
    const saved = await insertVersion(tx, {
      owner: input.owner,
      staffId: input.staff.id,
      skillId: base.id,
      text: {
        name: plan.state.name,
        description: plan.state.description,
        body: plan.state.body,
      },
      note: plan.note,
    });
    await auditIn(tx, {
      owner: input.owner,
      actor: { kind: "staff", staff: input.staff },
      action: "skill.restored",
      summary: `${plan.note} on Skill ${base.id} (now Version ${saved.version})`,
      target: { kind: "skill", id: base.id },
      detail: {
        version: saved.version,
        restoredFrom: plan.from === null ? "default" : plan.from,
      },
    });
    return saved;
  });
  return skillView(base, latestOfRow(row));
}

/** A Skill's saved Versions, newest first. Empty while only the Default applies (and for a Rulebook, whose history is its Rules'). */
export async function skillHistory(
  owner: Owner,
  skillId: string,
): Promise<SkillVersion[]> {
  const base = defaultOf(skillId);
  if (base.kind === "rulebook") return [];
  const rows = await versionRows(sql(), owner, base.id);
  return rows.map(versionOfRow);
}

/**
 * The Claude Plugin as a zip: `.claude-plugin/plugin.json`, one
 * `skills/<name>/SKILL.md` per current Skill (Rulebooks rendered from the
 * current Rules), `.mcp.json` pointing at `<origin>/api/harness/mcp` and a
 * README. No token goes in it. The route checks `plugin.download` and writes
 * `plugin.downloaded`.
 */
export async function buildPluginZip(
  owner: Owner,
  origin: string,
): Promise<{
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
  files: string[];
}> {
  const skills = await listSkills(owner);
  const files = pluginFiles({
    origin,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      version: skill.version,
    })),
  });
  const entries = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
  );
  return {
    filename: PLUGIN_FILENAME,
    bytes: new Uint8Array(zipSync(entries)),
    files: Object.keys(files),
  };
}
