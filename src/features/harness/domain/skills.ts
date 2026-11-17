import type { PipelineId } from "./pipeline";
import { SKILL_DEFAULT_LIST } from "./skills/defaults";

/** The limits Claude's `SKILL.md` format puts on a Skill. */
export const SKILL_LIMITS = {
  nameChars: 64,
  descriptionChars: 1024,
  bodyChars: 60_000,
} as const;

/** Lowercase letters, digits and single hyphens: `member-request`. */
export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A `skill` is edited as text; a `rulebook` as Rule cards (its body is rendered from the Rules). */
export type SkillKind = "skill" | "rulebook";

/** What a Skill says: the three parts of a `SKILL.md`. */
export type SkillText = {
  /** Also the folder name in the Plugin. */
  name: string;
  /** One line that says when to use it; the Agent sees only this until it loads the Skill. */
  description: string;
  body: string;
};

/** The Skill as it ships with the Harness. */
export type SkillDefault = SkillText & {
  id: string;
  kind: SkillKind;
  /** The Pipeline it describes, or whose Rules it holds. */
  pipelineId?: PipelineId;
};

/** The Skill as the Workspace has it now: the Default, or its latest Version. */
export type SkillView = SkillText & {
  id: string;
  kind: SkillKind;
  pipelineId: PipelineId | null;
  /** 0 while the Default applies. */
  version: number;
  /** True when the current text differs from the Default. */
  edited: boolean;
  savedBy: { id: string; name: string } | null;
  savedAt: string | null;
  default: SkillText;
};

/** One saved state of a Skill. */
export type SkillVersion = SkillText & {
  skillId: string;
  version: number;
  savedBy: { id: string; name: string };
  note: string | null;
  createdAt: string;
};

/** Every Default by Skill id, assembled from `skills/defaults.ts` (the Skills slice owns that file). */
export const SKILL_DEFAULTS: Readonly<Record<string, SkillDefault>> =
  Object.fromEntries(SKILL_DEFAULT_LIST.map((skill) => [skill.id, skill]));

export function sameSkillText(a: SkillText, b: SkillText): boolean {
  return (
    a.name === b.name && a.description === b.description && a.body === b.body
  );
}

/** The view of a Skill given its Default and the latest Version saved, if any. */
export function skillView(
  base: SkillDefault,
  latest: Pick<
    SkillVersion,
    "name" | "description" | "body" | "version" | "savedBy" | "createdAt"
  > | null,
): SkillView {
  const text: SkillText = latest ?? base;
  const fallback: SkillText = {
    name: base.name,
    description: base.description,
    body: base.body,
  };
  return {
    id: base.id,
    kind: base.kind,
    pipelineId: base.pipelineId ?? null,
    name: text.name,
    description: text.description,
    body: text.body,
    version: latest?.version ?? 0,
    edited: latest ? !sameSkillText(latest, fallback) : false,
    savedBy: latest?.savedBy ?? null,
    savedAt: latest?.createdAt ?? null,
    default: fallback,
  };
}

export type SkillProblem = {
  field: "name" | "description" | "body";
  message: string;
};

/** What stops a Skill from being saved, or an empty list. */
export function skillProblems(skill: SkillText): SkillProblem[] {
  const problems: SkillProblem[] = [];
  if (!skill.name) {
    problems.push({ field: "name", message: "Give the Skill a name." });
  } else if (skill.name.length > SKILL_LIMITS.nameChars) {
    problems.push({
      field: "name",
      message: `The name is at most ${SKILL_LIMITS.nameChars} characters.`,
    });
  } else if (!SKILL_NAME.test(skill.name)) {
    problems.push({
      field: "name",
      message: "Use lowercase letters, digits and single hyphens in the name.",
    });
  }
  const description = skill.description.trim();
  if (!description) {
    problems.push({
      field: "description",
      message: "Say in one line when to use the Skill.",
    });
  } else if (description.length > SKILL_LIMITS.descriptionChars) {
    problems.push({
      field: "description",
      message: `The description is at most ${SKILL_LIMITS.descriptionChars} characters.`,
    });
  } else if (/[\r\n]/.test(description)) {
    problems.push({
      field: "description",
      message: "Keep the description on one line.",
    });
  }
  if (!skill.body.trim()) {
    problems.push({
      field: "body",
      message: "Write the Skill's instructions.",
    });
  } else if (skill.body.length > SKILL_LIMITS.bodyChars) {
    problems.push({
      field: "body",
      message: `The instructions are at most ${SKILL_LIMITS.bodyChars} characters.`,
    });
  }
  return problems;
}

/** A YAML scalar that reads back as exactly this text: plain when safe, double-quoted otherwise. */
function yamlScalar(value: string): string {
  const plain =
    /^[A-Za-z0-9][A-Za-z0-9 _.,()/'-]*$/.test(value) &&
    !/\s$/.test(value) &&
    !/^(true|false|null|yes|no|on|off|~)$/i.test(value) &&
    !/^[-+]?[0-9.]+$/.test(value);
  return plain ? value : JSON.stringify(value);
}

/** The Skill as a `SKILL.md` file: YAML frontmatter (`name`, `description`), then the body. */
export function renderSkillMd(skill: SkillText): string {
  return [
    "---",
    `name: ${yamlScalar(skill.name)}`,
    `description: ${yamlScalar(skill.description.trim())}`,
    "---",
    "",
    skill.body.trim(),
    "",
  ].join("\n");
}

export type ParsedSkill =
  | { ok: true; skill: SkillText }
  | { ok: false; error: string };

function readScalar(raw: string): string | null {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'")) {
    return value.endsWith("'") && value.length >= 2
      ? value.slice(1, -1).replace(/''/g, "'")
      : null;
  }
  return value;
}

/**
 * Reads a `SKILL.md`: the frontmatter's `name` and `description` (plain or
 * quoted, a plain value may run on over indented lines) and the body after
 * it. Other frontmatter keys are ignored. It does not check the limits;
 * `skillProblems` does.
 */
export function parseSkillMd(text: string): ParsedSkill {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { ok: false, error: "A SKILL.md starts with a --- line." };
  }
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end === -1) {
    return {
      ok: false,
      error: "The frontmatter is not closed with a --- line.",
    };
  }
  const fields = new Map<string, string>();
  let key: string | null = null;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (match?.[1] && !/^\s/.test(line)) {
      key = match[1];
      fields.set(key, (match[2] ?? "").trim());
    } else if (key && /^\s+/.test(line)) {
      fields.set(key, `${fields.get(key) ?? ""} ${line.trim()}`.trim());
    } else {
      return {
        ok: false,
        error: `Could not read the frontmatter line "${line.trim()}".`,
      };
    }
  }
  const name = readScalar(fields.get("name") ?? "");
  const description = readScalar(fields.get("description") ?? "");
  if (!name) return { ok: false, error: "The frontmatter needs a name." };
  if (!description) {
    return { ok: false, error: "The frontmatter needs a description." };
  }
  return {
    ok: true,
    skill: {
      name,
      description,
      body: lines
        .slice(end + 1)
        .join("\n")
        .trim(),
    },
  };
}
