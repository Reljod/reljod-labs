import type { SkillDefault } from "../skills";

/**
 * Owned by the Skills slice. The Default of every Skill the Harness ships
 * with, Rulebooks included (their body is rendered from the Rules, so a
 * Rulebook's `body` here is only its introduction). Empty until that slice
 * lands.
 */
export const SKILL_DEFAULT_LIST: SkillDefault[] = [];
