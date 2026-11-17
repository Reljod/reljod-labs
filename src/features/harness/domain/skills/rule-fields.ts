import {
  type ParameterSpec,
  type ParameterValue,
  parameterProblem,
  type RuleEdit,
  type RuleSpec,
  type RuleState,
} from "../rules";

/**
 * What a Rule card holds while it is being edited. Numbers stay as the text
 * typed (so "12." or "" can be on screen while typing), a list is its items.
 */
export type ParamDraft = string | string[];
export type ParamDrafts = Record<string, ParamDraft>;

export type CardDraft = {
  enabled: boolean;
  outcome: RuleState["outcome"];
  effectiveFrom: string;
  params: ParamDrafts;
};

/** The unit drawn beside a number: `CI$`, `%`, `days`, or the spec's own. Null when it has none. */
export function unitOf(spec: ParameterSpec): {
  before?: string;
  after?: string;
} {
  switch (spec.kind) {
    case "money":
      return { before: "CI$" };
    case "percent":
      return { after: "%" };
    case "days":
    case "months":
    case "years":
      return { after: spec.kind };
    case "number":
      return spec.unit ? { after: spec.unit } : {};
    default:
      return {};
  }
}

export function draftOfValue(
  spec: ParameterSpec,
  value: ParameterValue | undefined,
): ParamDraft {
  if (spec.kind === "list") return Array.isArray(value) ? [...value] : [];
  if (value === undefined) return "";
  return String(value);
}

export function draftOfState(
  spec: RuleSpec,
  state: Omit<RuleState, "version">,
): CardDraft {
  const params: ParamDrafts = {};
  for (const [name, parameter] of Object.entries(spec.params)) {
    params[name] = draftOfValue(parameter, state.params[name]);
  }
  return {
    enabled: state.enabled,
    outcome: state.outcome,
    effectiveFrom: state.effectiveFrom,
    params,
  };
}

export type ParsedParam =
  | { ok: true; value: ParameterValue }
  | { ok: false; message: string };

/** Reads what was typed into a field as the Parameter's value, checked against its spec. */
export function parseParamDraft(
  name: string,
  spec: ParameterSpec,
  draft: ParamDraft | undefined,
): ParsedParam {
  if (spec.kind === "enum") {
    const value = typeof draft === "string" ? draft : "";
    const problem = parameterProblem(name, spec, value);
    return problem
      ? { ok: false, message: problem.message }
      : { ok: true, value };
  }
  if (spec.kind === "list") {
    const items = Array.isArray(draft) ? draft : [];
    const problem = parameterProblem(name, spec, items);
    return problem
      ? { ok: false, message: problem.message }
      : { ok: true, value: items };
  }
  const text = (typeof draft === "string" ? draft : "")
    .replace(/[,\s]/g, "")
    .replace(/^CI\$/i, "");
  if (text === "") {
    return { ok: false, message: `${spec.label}: give a number.` };
  }
  const number = Number(text);
  if (!Number.isFinite(number)) {
    return { ok: false, message: `${spec.label}: give a number.` };
  }
  const problem = parameterProblem(name, spec, number);
  return problem
    ? { ok: false, message: problem.message }
    : { ok: true, value: number };
}

/** The message under each field that does not hold, by Parameter name. */
export function draftProblems(
  spec: RuleSpec,
  draft: CardDraft,
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const [name, parameter] of Object.entries(spec.params)) {
    const parsed = parseParamDraft(name, parameter, draft.params[name]);
    if (!parsed.ok) problems[name] = parsed.message;
  }
  return problems;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function dateProblem(value: string): string | null {
  if (!ISO_DATE.test(value)) return "Give the date as YYYY-MM-DD.";
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? null
    : "That is not a real date.";
}

function sameDraft(a: ParamDraft | undefined, b: ParamDraft | undefined) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

/** Whether the card differs from the state it was opened on (so Save and Discard show). */
export function isDirty(spec: RuleSpec, base: CardDraft, draft: CardDraft) {
  return (
    base.enabled !== draft.enabled ||
    base.outcome !== draft.outcome ||
    base.effectiveFrom !== draft.effectiveFrom ||
    Object.keys(spec.params).some(
      (name) => !sameDraft(base.params[name], draft.params[name]),
    )
  );
}

/**
 * The edit to send: only what differs from `base`. Numbers are read from the
 * text; a field that does not parse is left out (the card shows its problem
 * and Save stays off).
 */
export function editOfDraft(
  spec: RuleSpec,
  base: CardDraft,
  draft: CardDraft,
): RuleEdit {
  const edit: RuleEdit = {};
  if (draft.enabled !== base.enabled) edit.enabled = draft.enabled;
  if (draft.outcome !== base.outcome) edit.outcome = draft.outcome;
  if (draft.effectiveFrom !== base.effectiveFrom) {
    edit.effectiveFrom = draft.effectiveFrom;
  }
  const params: Record<string, unknown> = {};
  for (const [name, parameter] of Object.entries(spec.params)) {
    if (sameDraft(base.params[name], draft.params[name])) continue;
    const parsed = parseParamDraft(name, parameter, draft.params[name]);
    if (parsed.ok) params[name] = parsed.value;
  }
  if (Object.keys(params).length > 0) edit.params = params;
  return edit;
}

/** Whether a Parameter's draft differs from the Default's, to highlight it. */
export function differsFromDefault(
  spec: RuleSpec,
  name: string,
  draft: ParamDraft | undefined,
): boolean {
  const parameter = spec.params[name];
  if (!parameter) return false;
  return !sameDraft(draftOfValue(parameter, spec.defaults[name]), draft);
}
