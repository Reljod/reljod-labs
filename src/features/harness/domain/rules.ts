import type { PipelineId, PipelineSpec } from "./pipeline";

/**
 * What a Rule that is not met does to the Run: `block` (the case cannot
 * proceed), `refer` (a person must look) or `warn` (noted, the Run goes on).
 */
export const OUTCOMES = ["block", "refer", "warn"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  block: "Block",
  refer: "Refer",
  warn: "Warn",
};

export const NUMBER_KINDS = [
  "number",
  "money",
  "percent",
  "days",
  "months",
  "years",
] as const;
export type NumberKind = (typeof NUMBER_KINDS)[number];

/**
 * A value inside a Rule that an admin may change without touching code.
 * `money` is Cayman Islands dollars; `days`, `months` and `years` are whole
 * numbers shown with their unit; `number` may carry a unit of its own.
 */
export type ParameterSpec =
  | {
      kind: NumberKind;
      label: string;
      min?: number;
      max?: number;
      /** The value must be `min` (or 0) plus a whole number of steps. */
      step?: number;
      /** For `number`: what follows the value ("payments"). */
      unit?: string;
    }
  | {
      kind: "enum";
      label: string;
      options: { value: string; label: string }[];
    }
  | {
      kind: "list";
      label: string;
      /** When given, every item must be one of these. */
      options?: { value: string; label: string }[];
      minItems?: number;
      maxItems?: number;
    };

export type ParameterValue = number | string | string[];
export type RuleParams = Record<string, ParameterValue>;

/** A Rule as it ships: the sentence, its Parameters and where it comes from. The check is code. */
export type RuleSpec = {
  id: string;
  pipelineId: PipelineId;
  /** The Step whose check uses it. */
  stepId: string;
  title: string;
  /** A plain sentence with its Parameters as `{name}` slots. */
  sentence: string;
  params: Record<string, ParameterSpec>;
  defaults: RuleParams;
  defaultOutcome: Outcome;
  /** Where the Rule comes from: the section of the Act, the plan rules. */
  citation: string;
  /** `YYYY-MM-DD`: the date the Default took effect. */
  effectiveFrom: string;
};

/** A Rule as the Workspace has it now. Version 0 is the Default. */
export type RuleState = {
  version: number;
  enabled: boolean;
  params: RuleParams;
  outcome: Outcome;
  effectiveFrom: string;
};

export type RuleView = {
  spec: RuleSpec;
  /** The latest saved state (what the editor edits); it may be scheduled for a later date. */
  state: RuleState;
  /**
   * The state a Run started today applies: its Version, since when, and its
   * Parameters, Outcome and switch. It differs from `state` while the latest
   * Version is scheduled (`state.effectiveFrom` is after today): show
   * "scheduled, in force from <state.effectiveFrom>" then. Null when the Rule
   * is not yet in force at all.
   */
  inForce: RuleState | null;
  /**
   * The next state a Run will apply, from its `effectiveFrom`, when a change
   * is scheduled after today; else null (`nextScheduledRuleState`).
   */
  scheduled: RuleState | null;
  /** True when the state differs from the Default. */
  edited: boolean;
  savedBy: { id: string; name: string } | null;
  savedAt: string | null;
};

/** One saved state of a Rule. */
export type RuleVersion = RuleState & {
  ruleId: string;
  savedBy: { id: string; name: string };
  note: string | null;
  createdAt: string;
};

/** What an admin may change on a Rule card. Anything left out stays as it is. */
export type RuleEdit = {
  enabled?: boolean;
  params?: Record<string, unknown>;
  outcome?: unknown;
  effectiveFrom?: unknown;
};

export type RuleEditErrorCode =
  | "unknown_parameter"
  | "wrong_type"
  | "below_min"
  | "above_max"
  | "off_step"
  | "not_whole"
  | "not_an_option"
  | "too_few"
  | "too_many"
  | "bad_outcome"
  | "bad_date";

export type RuleEditError = {
  field: "params" | "outcome" | "effectiveFrom" | "enabled";
  /** The Parameter at fault, for `params`. */
  param?: string;
  code: RuleEditErrorCode;
  message: string;
};

export type RuleEditResult =
  | { ok: true; next: Omit<RuleState, "version"> }
  | { ok: false; errors: RuleEditError[] };

export function defaultRuleState(spec: RuleSpec): RuleState {
  return {
    version: 0,
    enabled: true,
    params: { ...spec.defaults },
    outcome: spec.defaultOutcome,
    effectiveFrom: spec.effectiveFrom,
  };
}

function sameValue(
  a: ParameterValue | undefined,
  b: ParameterValue | undefined,
) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

/** Whether a state says what the Default says, whatever its Version. */
export function isDefaultState(
  spec: RuleSpec,
  state: Omit<RuleState, "version">,
): boolean {
  const base = defaultRuleState(spec);
  return (
    state.enabled === base.enabled &&
    state.outcome === base.outcome &&
    state.effectiveFrom === base.effectiveFrom &&
    Object.keys(spec.params).every((name) =>
      sameValue(state.params[name], base.params[name]),
    )
  );
}

const WHOLE: ReadonlySet<string> = new Set(["days", "months", "years"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Whether `value` is `base` plus a whole number of steps, allowing for float noise. */
function onStep(value: number, base: number, step: number) {
  const steps = (value - base) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** What is wrong with one Parameter's value, or null. */
export function parameterProblem(
  name: string,
  spec: ParameterSpec,
  value: unknown,
): RuleEditError | null {
  const fail = (code: RuleEditErrorCode, message: string): RuleEditError => ({
    field: "params",
    param: name,
    code,
    message: `${spec.label}: ${message}`,
  });
  if (spec.kind === "enum") {
    if (typeof value !== "string")
      return fail("wrong_type", "pick one option.");
    return spec.options.some((option) => option.value === value)
      ? null
      : fail("not_an_option", "that is not one of the options.");
  }
  if (spec.kind === "list") {
    if (
      !Array.isArray(value) ||
      !value.every((item): item is string => typeof item === "string")
    ) {
      return fail("wrong_type", "give a list of text values.");
    }
    if (value.some((item) => !item.trim())) {
      return fail("wrong_type", "an item cannot be empty.");
    }
    if (spec.options) {
      const allowed = new Set(spec.options.map((option) => option.value));
      if (!value.every((item) => allowed.has(item))) {
        return fail("not_an_option", "an item is not one of the options.");
      }
    }
    if (value.length < (spec.minItems ?? 0)) {
      return fail("too_few", `needs at least ${spec.minItems} items.`);
    }
    if (spec.maxItems !== undefined && value.length > spec.maxItems) {
      return fail("too_many", `takes at most ${spec.maxItems} items.`);
    }
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail("wrong_type", "give a number.");
  }
  if (WHOLE.has(spec.kind) && !Number.isInteger(value)) {
    return fail("not_whole", `give a whole number of ${spec.kind}.`);
  }
  if (spec.min !== undefined && value < spec.min) {
    return fail(
      "below_min",
      `cannot be less than ${formatParameter(spec, spec.min)}.`,
    );
  }
  if (spec.max !== undefined && value > spec.max) {
    return fail(
      "above_max",
      `cannot be more than ${formatParameter(spec, spec.max)}.`,
    );
  }
  if (spec.step !== undefined && !onStep(value, spec.min ?? 0, spec.step)) {
    return fail("off_step", `goes in steps of ${spec.step}.`);
  }
  return null;
}

/**
 * Checks an edit against the Rule's schema (type, range, options) and, when
 * it holds, returns the state to save as the next Version: the current state
 * with the edit laid over it. A bad edit is refused where it was made, with
 * one error per field at fault (ADR 0015).
 */
export function validateRuleEdit(
  spec: RuleSpec,
  edit: RuleEdit,
  current: Omit<RuleState, "version"> = defaultRuleState(spec),
): RuleEditResult {
  const errors: RuleEditError[] = [];
  const params: RuleParams = { ...current.params };

  for (const [name, value] of Object.entries(edit.params ?? {})) {
    const parameter = spec.params[name];
    if (!parameter) {
      errors.push({
        field: "params",
        param: name,
        code: "unknown_parameter",
        message: `This Rule has no Parameter called "${name}".`,
      });
      continue;
    }
    const problem = parameterProblem(name, parameter, value);
    if (problem) errors.push(problem);
    else params[name] = value as ParameterValue;
  }

  if (edit.enabled !== undefined && typeof edit.enabled !== "boolean") {
    errors.push({
      field: "enabled",
      code: "wrong_type",
      message: "A Rule is switched on or off.",
    });
  }
  const outcome = edit.outcome ?? current.outcome;
  if (!(OUTCOMES as readonly unknown[]).includes(outcome)) {
    errors.push({
      field: "outcome",
      code: "bad_outcome",
      message: "The Outcome is block, refer or warn.",
    });
  }
  const effectiveFrom = edit.effectiveFrom ?? current.effectiveFrom;
  if (!isIsoDate(effectiveFrom)) {
    errors.push({
      field: "effectiveFrom",
      code: "bad_date",
      message: "Give the effective date as a real date (YYYY-MM-DD).",
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    next: {
      enabled:
        typeof edit.enabled === "boolean" ? edit.enabled : current.enabled,
      params,
      outcome: outcome as Outcome,
      effectiveFrom: effectiveFrom as string,
    },
  };
}

const money = new Intl.NumberFormat("en-KY", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const plural = (count: number, unit: string) =>
  `${count} ${count === 1 ? unit.replace(/s$/, "") : unit}`;

/** A Parameter's value as a person reads it: `CI$5,000`, `5%`, `30 days`. */
export function formatParameter(
  spec: ParameterSpec,
  value: ParameterValue | undefined,
): string {
  if (value === undefined) return "…";
  if (spec.kind === "enum") {
    return (
      spec.options.find((option) => option.value === value)?.label ??
      String(value)
    );
  }
  if (spec.kind === "list") {
    const items = Array.isArray(value) ? value : [String(value)];
    const labels = items.map(
      (item) =>
        spec.options?.find((option) => option.value === item)?.label ?? item,
    );
    return labels.length > 0 ? labels.join(", ") : "none";
  }
  const number = Number(value);
  switch (spec.kind) {
    case "money":
      return `CI$${money.format(number)}`;
    case "percent":
      return `${number}%`;
    case "days":
    case "months":
    case "years":
      return plural(number, spec.kind);
    case "number":
      return spec.unit ? `${number} ${spec.unit}` : String(number);
  }
}

/** A piece of a Rule's sentence: plain text, or a Parameter a card draws as an inline field. */
export type SentenceSegment =
  | { type: "text"; text: string }
  | {
      type: "param";
      name: string;
      spec: ParameterSpec;
      value: ParameterValue | undefined;
      /** The value as text, for reading and for the Rulebook. */
      text: string;
    };

const SLOT = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * Splits a Rule's sentence at its `{param}` slots. A slot that names no
 * Parameter stays as text, braces and all, so a typo in a spec is visible.
 */
export function renderRuleSentence(
  spec: Pick<RuleSpec, "sentence" | "params">,
  params: RuleParams,
): SentenceSegment[] {
  const segments: SentenceSegment[] = [];
  let last = 0;
  const text = (value: string) => {
    if (!value) return;
    const previous = segments.at(-1);
    if (previous?.type === "text") previous.text += value;
    else segments.push({ type: "text", text: value });
  };
  for (const match of spec.sentence.matchAll(SLOT)) {
    const name = match[1] ?? "";
    const parameter = spec.params[name];
    text(spec.sentence.slice(last, match.index));
    last = match.index + match[0].length;
    if (!parameter) {
      text(match[0]);
      continue;
    }
    segments.push({
      type: "param",
      name,
      spec: parameter,
      value: params[name],
      text: formatParameter(parameter, params[name]),
    });
  }
  text(spec.sentence.slice(last));
  return segments;
}

/** The sentence as plain text, Parameters filled in. */
export function ruleSentenceText(
  spec: Pick<RuleSpec, "sentence" | "params">,
  params: RuleParams,
): string {
  return renderRuleSentence(spec, params)
    .map((segment) => segment.text)
    .join("");
}

const OUTCOME_MEANING: Record<Outcome, string> = {
  block: "the case cannot proceed",
  refer: "a person must look",
  warn: "it is noted and the Run goes on",
};

/** What changes from one state of a Rule to another, in words: Parameters, Outcome, switch. */
export function describeRuleChange(
  spec: Pick<RuleSpec, "params">,
  before: Omit<RuleState, "version"> | null,
  after: Omit<RuleState, "version">,
): string {
  const parts: string[] = [];
  if (!before || before.enabled !== after.enabled) {
    if (!after.enabled) parts.push("switched off");
    else if (before) parts.push("switched on");
  }
  for (const [name, parameter] of Object.entries(spec.params)) {
    const a = before?.params[name];
    const b = after.params[name];
    const same =
      Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((item, index) => item === b[index])
        : a === b;
    if (same) continue;
    parts.push(
      before
        ? `${parameter.label || name} ${formatParameter(parameter, a)} → ${formatParameter(parameter, b)}`
        : `${parameter.label || name} ${formatParameter(parameter, b)}`,
    );
  }
  if (after.enabled && (!before || before.outcome !== after.outcome)) {
    parts.push(
      before
        ? `Outcome ${before.outcome} → ${after.outcome}`
        : `Outcome ${after.outcome}`,
    );
  }
  return parts.length > 0 ? parts.join("; ") : "no change to its values";
}

const versionName = (version: number) =>
  version === 0 ? "Default" : `Version ${version}`;

/** A Rule as the Rulebook renders it. Without `inForce`, `state` is taken to be in force. */
export type RulebookRule = Pick<RuleView, "spec" | "state"> &
  Partial<Pick<RuleView, "inForce" | "scheduled">>;

/**
 * The body of a Pipeline's Rulebook Skill: its Rules as a Run started today
 * applies them (the Version in force, not a later one saved for a future
 * date), grouped by Step in the Pipeline's order, with any scheduled change
 * on one line. The Agent and Claude read this; a Run enforces the same Rules
 * in code (ADR 0015).
 */
export function renderRulebookMd(
  pipeline: Pick<PipelineSpec, "id" | "title" | "steps">,
  rules: RulebookRule[],
): string {
  const mine = rules.filter((rule) => rule.spec.pipelineId === pipeline.id);
  const lines: string[] = [
    `# Rulebook: ${pipeline.title}`,
    "",
    `These are the Rules the \`${pipeline.id}\` Pipeline checks, with the values a Run started today applies in this Workspace. The checks are code: a Run applies them exactly as written and records the Version of each. Quote a Rule by its id. Do not decide a case from this text; start a Run.`,
    "",
    "When a Rule is not met its Outcome says what happens: **block** (the case cannot proceed), **refer** (a person must look) or **warn** (it is noted and the Run goes on).",
  ];
  const known = new Set(pipeline.steps.map((step) => step.id));
  const groups = [
    ...pipeline.steps.map((step) => ({
      title: step.title,
      rules: mine.filter((rule) => rule.spec.stepId === step.id),
    })),
    {
      title: "Other Rules",
      rules: mine.filter((rule) => !known.has(rule.spec.stepId)),
    },
  ];
  for (const group of groups) {
    if (group.rules.length === 0) continue;
    lines.push("", `## ${group.title}`);
    for (const rule of group.rules) {
      const { spec } = rule;
      const inForce = rule.inForce === undefined ? rule.state : rule.inForce;
      const scheduled = rule.scheduled ?? null;
      if (!inForce) {
        // Not in force yet: say from when, and what it will say then.
        const coming = scheduled ?? rule.state;
        lines.push(
          "",
          `### ${spec.title} (not in force until ${coming.effectiveFrom})`,
          "",
          ruleSentenceText(spec, coming.params),
          "",
          `- Rule: \`${spec.id}\` · not in force until ${coming.effectiveFrom}: a Run started before then does not check it.`,
          `- From ${coming.effectiveFrom}: ${versionName(coming.version)}, ${describeRuleChange(spec, null, coming)}`,
          `- Source: ${spec.citation}`,
        );
        continue;
      }
      lines.push(
        "",
        `### ${spec.title}${inForce.enabled ? "" : " (switched off)"}`,
        "",
        ruleSentenceText(spec, inForce.params),
        "",
        `- Rule: \`${spec.id}\` · ${versionName(inForce.version)} · in effect from ${inForce.effectiveFrom}`,
        inForce.enabled
          ? `- If not met: **${inForce.outcome}** (${OUTCOME_MEANING[inForce.outcome]})`
          : "- Switched off: a Run does not check it.",
        ...(scheduled
          ? [
              `- Scheduled: ${versionName(scheduled.version)} from ${scheduled.effectiveFrom}: ${describeRuleChange(spec, inForce, scheduled)}`,
            ]
          : []),
        `- Source: ${spec.citation}`,
      );
    }
  }
  if (mine.length === 0) lines.push("", "This Pipeline has no Rules yet.");
  else {
    lines.push(
      "",
      "A scheduled Version applies to Runs started on or after its date. When more than one Version is in effect, the highest wins, so a Version saved later with an earlier date replaces one saved before it that was still scheduled.",
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A Rule as `list_rules` gives it: what a Run started today applies
 * (`inForce`, null while not yet in force) and the next scheduled change.
 * The highest Version already in effect wins, so a later-saved Version with
 * an earlier date replaces an earlier-saved future one.
 */
export function listedRule(rule: RuleView) {
  const stateOf = (state: RuleState) => ({
    rule: ruleSentenceText(rule.spec, state.params),
    enabled: state.enabled,
    outcome: state.outcome,
    version: state.version,
    effectiveFrom: state.effectiveFrom,
  });
  return {
    id: rule.spec.id,
    pipelineId: rule.spec.pipelineId,
    step: rule.spec.stepId,
    inForce: rule.inForce ? stateOf(rule.inForce) : null,
    scheduled: rule.scheduled
      ? {
          ...stateOf(rule.scheduled),
          changes: describeRuleChange(rule.spec, rule.inForce, rule.scheduled),
        }
      : null,
    citation: rule.spec.citation,
  };
}
