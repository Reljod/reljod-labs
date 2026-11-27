import "server-only";
import { strToU8, zipSync } from "fflate";
import { InvalidError, NotFoundError } from "@/platform/errors";
import { PLUGIN_FILENAME, PluginError, pluginFiles } from "../../domain/plugin";
import {
  SKILL_DEFAULTS,
  type SkillText,
  type SkillVersion,
  type SkillView,
  sameSkillText,
  skillProblems,
} from "../../domain/skills";
import { planRestore } from "../../domain/skills/versions";
import { assertCan } from "../errors";
import type { Actor, AuditLog, SkillRepository } from "../ports";
import { cleanNote } from "./rules";

/** A Skill and its saved Versions, as the editor reads it after a read or a save. */
export type SkillWithHistory = { skill: SkillView; history: SkillVersion[] };

/** The Claude Plugin zip. */
export type Plugin = {
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
  files: string[];
};

/**
 * Skills: `SKILL.md` text with a Default, edited as Versions (admin,
 * `skill.edit`). A Rulebook is edited as Rule cards, never as text. The
 * Plugin is the Workspace's current Skills plus the MCP server's address.
 */
export interface SkillService {
  list(actor: Actor): Promise<SkillView[]>;
  get(actor: Actor, skillId: string): Promise<SkillWithHistory>;
  /** By id, else by name (the chat's `load_skill`, the MCP `get_skill`); null when there is none. */
  find(actor: Actor, idOrName: string): Promise<SkillView | null>;
  save(
    actor: Actor,
    skillId: string,
    text: SkillText,
    note?: string | null,
  ): Promise<SkillWithHistory>;
  restore(
    actor: Actor,
    skillId: string,
    version?: number | null,
  ): Promise<SkillWithHistory>;
  /** The Plugin for download (`plugin.download`), recorded as `plugin.downloaded`. */
  plugin(actor: Actor, origin: string): Promise<Plugin>;
}

function editable(skillId: string) {
  const base = SKILL_DEFAULTS[skillId];
  if (!base) throw new NotFoundError("There is no such Skill.");
  if (base.kind === "rulebook") {
    throw new InvalidError(
      "A Rulebook is edited as Rule cards, not as text. Change its Rules instead.",
    );
  }
  return base;
}

export function createSkillService(ports: {
  skills: SkillRepository;
  audit: AuditLog;
}): SkillService {
  const { skills } = ports;
  const withHistory = async (
    actor: Actor,
    skill: SkillView,
  ): Promise<SkillWithHistory> => ({
    skill,
    history: await skills.history(actor.owner, skill.id),
  });

  return {
    list: (actor) => skills.list(actor.owner),

    async get(actor, skillId) {
      // Both are the Owner's and start together; the history is answered only with its Skill.
      const [skill, history] = await Promise.all([
        skills.get(actor.owner, skillId),
        SKILL_DEFAULTS[skillId]
          ? skills.history(actor.owner, skillId)
          : Promise.resolve([]),
      ]);
      if (!skill) throw new NotFoundError("There is no such Skill.");
      return { skill, history };
    },

    async find(actor, idOrName) {
      return (
        (await skills.get(actor.owner, idOrName)) ??
        (await skills.list(actor.owner)).find(
          (item) => item.name === idOrName,
        ) ??
        null
      );
    },

    async save(actor, skillId, raw, rawNote) {
      assertCan(actor.staff, "skill.edit");
      const base = editable(skillId);
      const text: SkillText = {
        name: raw.name.trim(),
        description: raw.description.trim(),
        body: raw.body.replace(/\r\n/g, "\n"),
      };
      const problems = skillProblems(text);
      if (problems.length > 0)
        throw new InvalidError(problems[0]?.message ?? "");
      const note = cleanNote(rawNote);
      const skill = await skills.saveVersion(
        actor.owner,
        base.id,
        actor.staff.id,
        ({ current }) => {
          if (sameSkillText(current, text)) {
            throw new InvalidError(
              "Nothing changed: the Skill already says that.",
            );
          }
          return {
            text,
            note,
            event: (version) => ({
              owner: actor.owner,
              actor: { kind: "staff", staff: actor.staff },
              action: "skill.saved",
              summary: `Saved Skill ${base.id} as Version ${version}`,
              target: { kind: "skill", id: base.id },
              detail: {
                version,
                previousVersion: current.version,
                nameChanged: current.name !== text.name,
                descriptionChanged: current.description !== text.description,
                bodyChars: [current.body.length, text.body.length],
                note,
              },
            }),
          };
        },
      );
      return withHistory(actor, skill);
    },

    async restore(actor, skillId, version) {
      assertCan(actor.staff, "skill.edit");
      const base = editable(skillId);
      const skill = await skills.saveVersion(
        actor.owner,
        base.id,
        actor.staff.id,
        ({ current, versions }) => {
          const plan = planRestore<SkillText>(
            { name: base.name, description: base.description, body: base.body },
            versions,
            version,
          );
          if (!plan) throw new NotFoundError("That Version was never saved.");
          if (sameSkillText(current, plan.state)) {
            throw new InvalidError(
              plan.from === null
                ? "The Skill already says what the Default says."
                : `The Skill already says what Version ${plan.from} says.`,
            );
          }
          return {
            text: {
              name: plan.state.name,
              description: plan.state.description,
              body: plan.state.body,
            },
            note: plan.note,
            event: (saved) => ({
              owner: actor.owner,
              actor: { kind: "staff", staff: actor.staff },
              action: "skill.restored",
              summary: `${plan.note} on Skill ${base.id} (now Version ${saved})`,
              target: { kind: "skill", id: base.id },
              detail: {
                version: saved,
                restoredFrom: plan.from === null ? "default" : plan.from,
              },
            }),
          };
        },
      );
      return withHistory(actor, skill);
    },

    async plugin(actor, origin) {
      assertCan(actor.staff, "plugin.download");
      const current = await skills.list(actor.owner);
      let files: Record<string, string>;
      try {
        files = pluginFiles({
          origin,
          skills: current.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            body: skill.body,
            version: skill.version,
          })),
        });
      } catch (error) {
        if (error instanceof PluginError) throw new InvalidError(error.message);
        throw error;
      }
      const bytes = new Uint8Array(
        zipSync(
          Object.fromEntries(
            Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
          ),
        ),
      );
      const names = Object.keys(files);
      await ports.audit.record({
        owner: actor.owner,
        actor: { kind: "staff", staff: actor.staff },
        action: "plugin.downloaded",
        summary: `Downloaded the Claude plugin (${names.length} files)`,
        target: { kind: "plugin", id: "jod-harness-bank" },
        detail: { files: names.length, bytes: bytes.byteLength },
      });
      return { filename: PLUGIN_FILENAME, bytes, files: names };
    },
  };
}
