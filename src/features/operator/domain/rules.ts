import { z } from "zod";
import type { ScreenCode } from "../legacy/types";
import { SCREEN_TITLES } from "../legacy/types";
import {
  ACTION_KINDS,
  ACTION_TITLES,
  FIELD_CODES,
} from "./rule-kinds";

/**
 * The Rules of what the Operator may do in HARBOURMASTER. Rules are data: a
 * Rulebook an Owner edits, saved as versions. The Guard (guard.ts) and the
 * checks (checks.ts) that apply them are code, and only code refuses an
 * Action, pauses for a person or returns a Finding (ADR 0025, after ADR 0015).
 */

export const SCREEN_CODES = Object.keys(SCREEN_TITLES) as [
  ScreenCode,
  ...ScreenCode[],
];

export * from "./rule-kinds";

export const RULE_LIMITS = { maxRecords: 200 } as const;

export const rulebookSchema = z.object({
  /** Which Screens the Operator may enter. */
  screens: z.object({
    enabled: z.boolean(),
    allowed: z.array(z.enum(SCREEN_CODES)).max(SCREEN_CODES.length),
  }),
  /** The most records one Run may add, change or delete. */
  records: z.object({
    enabled: z.boolean(),
    max: z.number().int().min(1).max(RULE_LIMITS.maxRecords),
  }),
  /** Fields of an existing record nobody but a person may change. */
  protectedFields: z.object({
    enabled: z.boolean(),
    fields: z.array(z.enum(FIELD_CODES)).max(FIELD_CODES.length),
  }),
  /** Actions that wait for a person. */
  guarded: z.object({
    enabled: z.boolean(),
    actions: z.array(z.enum(ACTION_KINDS)).max(ACTION_KINDS.length),
  }),
  /** A container number must carry a valid ISO 6346 check digit. */
  checkDigit: z.object({ enabled: z.boolean() }),
  /** The session must be signed off when the Run ends. */
  signOff: z.object({ enabled: z.boolean() }),
  /** Nothing beyond what the Task asked for may change. */
  scope: z.object({ enabled: z.boolean() }),
  /** What was keyed must equal the attached Manifest. */
  manifest: z.object({ enabled: z.boolean() }),
});

export type Rulebook = z.infer<typeof rulebookSchema>;

export const DEFAULT_RULEBOOK: Rulebook = {
  screens: {
    enabled: true,
    allowed: SCREEN_CODES.filter(
      (code) => code !== "HMT600" && code !== "HMA900",
    ),
  },
  records: { enabled: true, max: 30 },
  protectedFields: {
    enabled: true,
    fields: ["vessel.imo", "line.container", "line.consignee"],
  },
  guarded: { enabled: true, actions: ["hold.release", "line.delete"] },
  checkDigit: { enabled: true },
  signOff: { enabled: true },
  scope: { enabled: true },
  manifest: { enabled: true },
};

export type RuleId =
  | "screens.allowed"
  | "records.max"
  | "fields.protected"
  | "actions.guarded"
  | "containers.check-digit"
  | "session.sign-off"
  | "changes.in-scope"
  | "manifest.matches";

export type RuleInfo = {
  id: RuleId;
  /** The Rulebook key that holds its switch and Parameters. */
  key: keyof Rulebook;
  title: string;
  /** When code applies it. */
  when: "before the key is pressed" | "after the Run";
  /** What code does when it fires. */
  outcome: "refuses the Action" | "pauses for a person" | "returns a Finding";
  /** The Rule as a sentence, with its current Parameters. */
  sentence: (rulebook: Rulebook) => string;
};

const list = (items: readonly string[]) =>
  items.length === 0 ? "none" : items.join(", ");

export const RULES: RuleInfo[] = [
  {
    id: "screens.allowed",
    key: "screens",
    title: "Screens the Operator may enter",
    when: "before the key is pressed",
    outcome: "refuses the Action",
    sentence: (rulebook) =>
      `The Operator may enter only these Screens: ${list(rulebook.screens.allowed)}.`,
  },
  {
    id: "records.max",
    key: "records",
    title: "Records per Run",
    when: "before the key is pressed",
    outcome: "refuses the Action",
    sentence: (rulebook) =>
      `One Run may add, change or delete at most ${rulebook.records.max} records.`,
  },
  {
    id: "fields.protected",
    key: "protectedFields",
    title: "Fields it may never change",
    when: "before the key is pressed",
    outcome: "refuses the Action",
    sentence: (rulebook) =>
      `On a record already in the Books, these fields may not be changed: ${list(rulebook.protectedFields.fields)}.`,
  },
  {
    id: "actions.guarded",
    key: "guarded",
    title: "Actions that need a person",
    when: "before the key is pressed",
    outcome: "pauses for a person",
    sentence: (rulebook) =>
      `These Actions wait for a person to approve: ${list(rulebook.guarded.actions.map((kind) => ACTION_TITLES[kind].toLowerCase()))}.`,
  },
  {
    id: "containers.check-digit",
    key: "checkDigit",
    title: "Container check digit",
    when: "before the key is pressed",
    outcome: "refuses the Action",
    sentence: () =>
      "A container number is committed only if its ISO 6346 check digit is right.",
  },
  {
    id: "session.sign-off",
    key: "signOff",
    title: "Sign off at the end",
    when: "after the Run",
    outcome: "returns a Finding",
    sentence: () => "The session is signed off when the Run ends.",
  },
  {
    id: "changes.in-scope",
    key: "scope",
    title: "Nothing beyond the Task",
    when: "after the Run",
    outcome: "returns a Finding",
    sentence: () =>
      "The Books change only where the Task asked. Any other change is a Finding.",
  },
  {
    id: "manifest.matches",
    key: "manifest",
    title: "Keyed lines equal the Manifest",
    when: "after the Run",
    outcome: "returns a Finding",
    sentence: () =>
      "Every row of the attached Manifest is in the Books for its voyage, field for field.",
  },
];

export const ruleInfo = (id: RuleId) =>
  RULES.find((rule) => rule.id === id) as RuleInfo;

/** Whether a Rule is switched on in a Rulebook. */
export const ruleEnabled = (rulebook: Rulebook, id: RuleId) =>
  rulebook[ruleInfo(id).key].enabled;

/** The Rulebook as text, for the Operator's instructions and the Rules Skill. */
export function rulebookText(rulebook: Rulebook): string {
  return RULES.filter((rule) => rulebook[rule.key].enabled)
    .map(
      (rule) =>
        `- ${rule.sentence(rulebook)} (${rule.when}; code ${rule.outcome}.)`,
    )
    .join("\n");
}
