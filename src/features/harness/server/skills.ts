import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { SkillText, SkillVersion, SkillView } from "../domain/skills";
import type { Actor } from "./actor";
import { NotBuiltError } from "./errors";

/*
 * STUB. Owned by the Skills slice, which replaces every body here and keeps
 * the signatures. `SKILL_DEFAULTS` are the Defaults; `harness.skill_versions`
 * holds a Workspace's edits. A Rulebook's body is not stored: it is rendered
 * from the current Rules with `renderRulebookMd`, so `getSkill` on a
 * Rulebook always says what a Run enforces.
 */

/** Every Skill as the Workspace has it now, Rulebooks included, in Default order. */
export async function listSkills(_owner: Owner): Promise<SkillView[]> {
  throw new NotBuiltError("skills");
}

/** One Skill by id, or null when there is no such Skill. The chat's `load_skill` and the MCP server read it here. */
export async function getSkill(
  _owner: Owner,
  _skillId: string,
): Promise<SkillView | null> {
  throw new NotBuiltError("skills");
}

/**
 * Saves an edit as the Skill's next Version.
 *
 * Must: check `can(staff, "skill.edit")`; refuse a Rulebook (it is edited as
 * Rule cards) and anything `skillProblems` finds with an InvalidError;
 * insert Version n+1 (never update a row) and write `skill.saved` in the
 * same transaction (`auditIn`).
 */
export async function saveSkill(
  _input: Actor & { skillId: string; text: SkillText; note?: string | null },
): Promise<SkillView> {
  throw new NotBuiltError("skills");
}

/**
 * Puts a Skill back to its Default (`version` left out or 0) or to an
 * earlier Version, by saving that text as a new Version. Checks `can(staff,
 * "skill.edit")` and writes `skill.restored`.
 */
export async function restoreSkill(
  _input: Actor & { skillId: string; version?: number | null },
): Promise<SkillView> {
  throw new NotBuiltError("skills");
}

/** A Skill's saved Versions, newest first. Empty while only the Default applies. */
export async function skillHistory(
  _owner: Owner,
  _skillId: string,
): Promise<SkillVersion[]> {
  throw new NotBuiltError("skills");
}

/**
 * The Claude Plugin as a zip (fflate): `.claude-plugin/plugin.json`, one
 * `skills/<name>/SKILL.md` per current Skill (`renderSkillMd`), and an
 * `.mcp.json` that points at `<origin>/api/harness/mcp` (ADR 0013). No token
 * goes in the zip: Claude signs in with OAuth. The route checks
 * `plugin.download` and writes `plugin.downloaded`.
 */
export async function buildPluginZip(
  _owner: Owner,
  _origin: string,
): Promise<{ filename: string; bytes: Uint8Array }> {
  throw new NotBuiltError("skills");
}
