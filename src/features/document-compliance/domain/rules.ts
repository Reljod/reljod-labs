import type { RequirementId, Rulebook } from "./rulebook";

/**
 * Rules are data an Owner edits; the checks that use them stay code
 * (ADR 0019). A Rule is a sentence with typed Parameters and an on/off
 * switch. Its Default ships here; an edit saves a new Version for the Owner,
 * and a Pre-screen run records the Versions it applied.
 */

/** What a check does with a value that differs from the Client declaration. */
export const MISMATCH_OUTCOMES = ["needs_review", "fail"] as const;
export type MismatchOutcome = (typeof MISMATCH_OUTCOMES)[number];

export const CERTIFICATION_PARTS = [
  "wording",
  "certifier_name",
  "certifier_occupation",
  "date",
  "signature",
] as const;
export type CertificationPart = (typeof CERTIFICATION_PARTS)[number];

export const CERTIFICATION_PART_LABELS: Record<CertificationPart, string> = {
  wording: "certification wording",
  certifier_name: "certifier's name",
  certifier_occupation: "certifier's occupation",
  date: "certification date",
  signature: "signature",
};

const MISMATCH_OPTIONS = [
  { value: "needs_review", label: "Needs review" },
  { value: "fail", label: "Fail" },
];

/** A value inside a Rule that may change without touching code. */
export type ParameterSpec =
  | {
      kind: "days" | "months";
      label: string;
      min: number;
      max: number;
    }
  | {
      /** A share from 0 to 1, shown as a percentage. */
      kind: "percent";
      label: string;
      min: number;
      max: number;
      /** The value must be a whole number of these. */
      step: number;
    }
  | {
      kind: "enum";
      label: string;
      options: { value: string; label: string }[];
    }
  | {
      kind: "list";
      label: string;
      options: { value: string; label: string }[];
      minItems: number;
    };

export type ParameterValue = number | string | string[];
export type RuleParams = Record<string, ParameterValue>;

export const RULE_IDS = [
  "field-confidence",
  "identity-document-present",
  "identity-document-not-expired",
  "proof-of-address-present",
  "proof-of-address-recent",
  "name-matches",
  "date-of-birth-matches",
  "address-matches",
  "certification-complete",
  "documents-legible",
  "no-tampering",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export function isRuleId(value: unknown): value is RuleId {
  return (
    typeof value === "string" && (RULE_IDS as readonly string[]).includes(value)
  );
}

/** The stage of the Pre-screen whose code uses the Rule. */
export type RuleStage = "verify" | "evaluate";

export type RuleSpec = {
  id: RuleId;
  /** The Requirement it decides; null for a Rule that shapes every check. */
  requirementId: RequirementId | null;
  stage: RuleStage;
  /** A plain sentence with its Parameters as `{name}` slots. */
  sentence: string;
  params: Record<string, ParameterSpec>;
  defaults: RuleParams;
  /** False for a Rule every Pre-screen needs, which cannot be switched off. */
  optional: boolean;
  /** Where the Rule comes from. Meridia is fictional; so is its law. */
  citation: string;
};

export const RULE_SPECS: RuleSpec[] = [
  {
    id: "field-confidence",
    requirementId: null,
    stage: "verify",
    sentence:
      "A reading decides a Pass or a Fail only when the model is at least {minConfidence} sure of it and its text is found on the page.",
    params: {
      minConfidence: {
        kind: "percent",
        label: "Minimum confidence",
        min: 0.3,
        max: 0.95,
        step: 0.05,
      },
    },
    defaults: { minConfidence: 0.6 },
    optional: false,
    citation: "Meridian AML/CFT Guidance, para. 4.2 (reliable sources)",
  },
  {
    id: "identity-document-present",
    requirementId: "identity-document-present",
    stage: "evaluate",
    sentence:
      "The pack holds an identity document whose name and expiry date can be read.",
    params: {},
    defaults: {},
    optional: true,
    citation: "Meridian AML/CFT Act, s. 12(1)(a)",
  },
  {
    id: "identity-document-not-expired",
    requirementId: "identity-document-not-expired",
    stage: "evaluate",
    sentence:
      "The identity document is still valid {minValidityDays} after the Pre-screen date.",
    params: {
      minValidityDays: {
        kind: "days",
        label: "Validity left",
        min: 0,
        max: 365,
      },
    },
    defaults: { minValidityDays: 0 },
    optional: true,
    citation: "Meridian AML/CFT Act, s. 12(1)(a)",
  },
  {
    id: "proof-of-address-present",
    requirementId: "proof-of-address-present",
    stage: "evaluate",
    sentence:
      "The pack holds a proof of address whose name and address can be read.",
    params: {},
    defaults: {},
    optional: true,
    citation: "Meridian AML/CFT Act, s. 12(1)(b)",
  },
  {
    id: "proof-of-address-recent",
    requirementId: "proof-of-address-recent",
    stage: "evaluate",
    sentence:
      "The proof of address is dated within {maxAgeMonths} before the Pre-screen date.",
    params: {
      maxAgeMonths: { kind: "months", label: "Oldest", min: 1, max: 12 },
    },
    defaults: { maxAgeMonths: 3 },
    optional: true,
    citation: "Meridian AML/CFT Guidance, para. 5.3",
  },
  {
    id: "name-matches",
    requirementId: "name-matches",
    stage: "evaluate",
    sentence:
      "Every document names the declared client; a name that differs is marked {onMismatch}.",
    params: {
      onMismatch: {
        kind: "enum",
        label: "A differing name",
        options: MISMATCH_OPTIONS,
      },
    },
    defaults: { onMismatch: "needs_review" },
    optional: true,
    citation: "Meridian AML/CFT Act, s. 12(2)",
  },
  {
    id: "date-of-birth-matches",
    requirementId: "date-of-birth-matches",
    stage: "evaluate",
    sentence:
      "The date of birth on every document is the declared one; a date that differs is marked {onMismatch}.",
    params: {
      onMismatch: {
        kind: "enum",
        label: "A differing date",
        options: MISMATCH_OPTIONS,
      },
    },
    defaults: { onMismatch: "fail" },
    optional: true,
    citation: "Meridian AML/CFT Act, s. 12(2)",
  },
  {
    id: "address-matches",
    requirementId: "address-matches",
    stage: "evaluate",
    sentence:
      "The proof of address shows the declared address; an address that differs is marked {onMismatch}.",
    params: {
      onMismatch: {
        kind: "enum",
        label: "A differing address",
        options: MISMATCH_OPTIONS,
      },
    },
    defaults: { onMismatch: "needs_review" },
    optional: true,
    citation: "Meridian AML/CFT Guidance, para. 5.1",
  },
  {
    id: "certification-complete",
    requirementId: "certification-complete",
    stage: "evaluate",
    sentence: "The certified copy carries the {requiredParts}.",
    params: {
      requiredParts: {
        kind: "list",
        label: "Required parts",
        options: CERTIFICATION_PARTS.map((part) => ({
          value: part,
          label: CERTIFICATION_PART_LABELS[part],
        })),
        minItems: 1,
      },
    },
    defaults: { requiredParts: [...CERTIFICATION_PARTS] },
    optional: true,
    citation: "Meridian AML/CFT Guidance, para. 6.4 (certified copies)",
  },
  {
    id: "documents-legible",
    requirementId: "documents-legible",
    stage: "evaluate",
    sentence: "Every document can be read.",
    params: {},
    defaults: {},
    optional: true,
    citation: "Meridian AML/CFT Guidance, para. 4.2",
  },
  {
    id: "no-tampering",
    requirementId: "no-tampering",
    stage: "evaluate",
    sentence: "No document shows signs of tampering.",
    params: {},
    defaults: {},
    optional: true,
    citation: "Meridian AML/CFT Guidance, para. 4.5",
  },
];

export function ruleSpec(id: RuleId): RuleSpec {
  const spec = RULE_SPECS.find((item) => item.id === id);
  if (!spec) throw new Error(`Unknown Rule ${id}`);
  return spec;
}

/** A Rule as an Owner has it. Version 0 is the Default. */
export type RuleState = {
  version: number;
  enabled: boolean;
  params: RuleParams;
};

/** What a Pre-screen run applied of one Rule: enough to explain a Finding later. */
export type AppliedRule = RuleState & { ruleId: RuleId };

export function defaultRuleState(spec: RuleSpec): RuleState {
  return { version: 0, enabled: true, params: structuredClone(spec.defaults) };
}

function sameValue(a: ParameterValue | undefined, b: ParameterValue) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

/** Whether a state says what the Default says, whatever its Version. */
export function isDefaultState(spec: RuleSpec, state: RuleState) {
  return (
    state.enabled &&
    Object.entries(spec.defaults).every(([name, value]) =>
      sameValue(state.params[name], value),
    )
  );
}

export type RuleEditError = { param: string | null; message: string };

export type RuleEdit = { enabled?: unknown; params?: unknown };

export type RuleEditResult =
  | { ok: true; next: Omit<RuleState, "version"> }
  | { ok: false; errors: RuleEditError[] };

function checkParam(
  spec: ParameterSpec,
  value: unknown,
): { value: ParameterValue } | { error: string } {
  switch (spec.kind) {
    case "days":
    case "months": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return {
          error: `${spec.label} must be a whole number of ${spec.kind}.`,
        };
      }
      if (value < spec.min || value > spec.max) {
        return {
          error: `${spec.label} must be from ${spec.min} to ${spec.max} ${spec.kind}.`,
        };
      }
      return { value };
    }
    case "percent": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { error: `${spec.label} must be a number.` };
      }
      const steps = (value - spec.min) / spec.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        return {
          error: `${spec.label} must be a multiple of ${Math.round(spec.step * 100)}%.`,
        };
      }
      if (value < spec.min - 1e-9 || value > spec.max + 1e-9) {
        return {
          error: `${spec.label} must be from ${Math.round(spec.min * 100)}% to ${Math.round(spec.max * 100)}%.`,
        };
      }
      // Rounded so 0.1 + 0.2 never lands in the database as 0.30000000000000004.
      return { value: Math.round(value * 100) / 100 };
    }
    case "enum": {
      if (!spec.options.some((option) => option.value === value)) {
        return { error: `${spec.label} must be one of the listed options.` };
      }
      return { value: value as string };
    }
    case "list": {
      if (!Array.isArray(value)) {
        return { error: `${spec.label} must be a list.` };
      }
      const allowed = spec.options.map((option) => option.value);
      if (value.some((item) => !allowed.includes(item as string))) {
        return { error: `${spec.label} may hold only the listed options.` };
      }
      // Kept in the listed order, once each, so equal lists compare equal.
      const items = allowed.filter((item) => value.includes(item));
      if (items.length < spec.minItems) {
        return {
          error: `${spec.label} needs at least ${spec.minItems} item${spec.minItems === 1 ? "" : "s"}.`,
        };
      }
      return { value: items };
    }
  }
}

/**
 * Checks an edit against the Rule's Parameters and returns the state to save.
 * Anything the edit leaves out stays as it is; anything it cannot hold is
 * refused with a message for the field at fault.
 */
export function applyRuleEdit(
  spec: RuleSpec,
  current: RuleState,
  edit: RuleEdit,
): RuleEditResult {
  const errors: RuleEditError[] = [];
  let enabled = current.enabled;
  if (edit.enabled !== undefined) {
    if (typeof edit.enabled !== "boolean") {
      errors.push({ param: null, message: "The switch must be on or off." });
    } else if (!edit.enabled && !spec.optional) {
      errors.push({
        param: null,
        message: "This Rule shapes every check and cannot be switched off.",
      });
    } else {
      enabled = edit.enabled;
    }
  }

  const params: RuleParams = structuredClone(current.params);
  if (edit.params !== undefined) {
    if (
      typeof edit.params !== "object" ||
      edit.params === null ||
      Array.isArray(edit.params)
    ) {
      errors.push({ param: null, message: "Parameters must be an object." });
    } else {
      for (const [name, value] of Object.entries(edit.params)) {
        const paramSpec = spec.params[name];
        if (!paramSpec) {
          errors.push({ param: name, message: `Unknown Parameter "${name}".` });
          continue;
        }
        const checked = checkParam(paramSpec, value);
        if ("error" in checked) {
          errors.push({ param: name, message: checked.error });
        } else {
          params[name] = checked.value;
        }
      }
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, next: { enabled, params } };
}

/** Reads a saved state back, falling back to the Default for anything it cannot hold. */
export function storedRuleState(
  spec: RuleSpec,
  stored: { version: number; enabled: unknown; params: unknown },
): RuleState {
  const fallback = defaultRuleState(spec);
  const result = applyRuleEdit(spec, fallback, {
    enabled: spec.optional ? stored.enabled : true,
    params:
      typeof stored.params === "object" && stored.params !== null
        ? Object.fromEntries(
            Object.entries(stored.params).filter(
              ([name]) => name in spec.params,
            ),
          )
        : {},
  });
  return result.ok
    ? { version: stored.version, ...result.next }
    : { ...fallback, version: stored.version };
}

/** A Parameter's value as it reads inside its sentence. */
export function formatParam(spec: ParameterSpec, value: ParameterValue) {
  switch (spec.kind) {
    case "days":
    case "months": {
      const count = value as number;
      const unit = spec.kind === "days" ? "day" : "month";
      return `${count} ${unit}${count === 1 ? "" : "s"}`;
    }
    case "percent":
      return `${Math.round((value as number) * 100)}%`;
    case "enum":
      return (
        spec.options.find((option) => option.value === value)?.label ??
        String(value)
      );
    case "list": {
      const labels = (value as string[]).map(
        (item) =>
          spec.options.find((option) => option.value === item)?.label ?? item,
      );
      return labels.length <= 1
        ? (labels[0] ?? "")
        : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
    }
  }
}

export type SentencePart =
  | { kind: "text"; text: string }
  | { kind: "param"; name: string; text: string };

/** The sentence cut into text and Parameter slots, so a card can edit a slot in place. */
export function sentenceParts(spec: RuleSpec, params: RuleParams) {
  const parts: SentencePart[] = [];
  const pattern = /\{(\w+)\}/g;
  let last = 0;
  for (const match of spec.sentence.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) {
      parts.push({ kind: "text", text: spec.sentence.slice(last, index) });
    }
    const name = match[1];
    const paramSpec = spec.params[name];
    const value = params[name] ?? spec.defaults[name];
    parts.push({
      kind: "param",
      name,
      text: paramSpec ? formatParam(paramSpec, value) : `{${name}}`,
    });
    last = index + match[0].length;
  }
  if (last < spec.sentence.length) {
    parts.push({ kind: "text", text: spec.sentence.slice(last) });
  }
  return parts;
}

export function ruleSentence(spec: RuleSpec, params: RuleParams) {
  return sentenceParts(spec, params)
    .map((part) => part.text)
    .join("");
}

/** Every Rule at its Default. */
export function defaultRuleStates(): Record<RuleId, RuleState> {
  return Object.fromEntries(
    RULE_SPECS.map((spec) => [spec.id, defaultRuleState(spec)]),
  ) as Record<RuleId, RuleState>;
}

/** Short Requirement titles; the ones with a Parameter are built from it. */
function requirementTitle(id: RequirementId, params: RuleParams): string {
  switch (id) {
    case "identity-document-present":
      return "Identity document is present";
    case "identity-document-not-expired": {
      const days = params.minValidityDays as number;
      return days > 0
        ? `Identity document is valid for ${days} more day${days === 1 ? "" : "s"}`
        : "Identity document has not expired";
    }
    case "proof-of-address-present":
      return "Proof of address is present";
    case "proof-of-address-recent": {
      const months = params.maxAgeMonths as number;
      return `Proof of address is dated within ${months} month${months === 1 ? "" : "s"}`;
    }
    case "name-matches":
      return "Name matches across all documents";
    case "date-of-birth-matches":
      return "Date of birth matches across documents";
    case "address-matches":
      return "Address matches the declared address";
    case "certification-complete":
      return "Certified copy has a complete certification";
    case "documents-legible":
      return "Every document is legible";
    case "no-tampering":
      return "No document shows signs of tampering";
  }
}

/**
 * The Rulebook a Pre-screen applies, from the Owner's Rules. A Rule that is
 * switched off drops its Requirement, so it makes no Finding.
 */
export function resolveRulebook(
  states: Partial<Record<RuleId, RuleState>>,
): Rulebook {
  const stateOf = (id: RuleId) => states[id] ?? defaultRuleState(ruleSpec(id));
  const param = <T extends ParameterValue>(id: RuleId, name: string) =>
    (stateOf(id).params[name] ?? ruleSpec(id).defaults[name]) as T;

  return {
    id: "individual-onboarding",
    version: "1",
    title: "Individual onboarding",
    jurisdiction: "Meridian AML/CFT customer due diligence",
    minFieldConfidence: param<number>("field-confidence", "minConfidence"),
    identityMinValidityDays: param<number>(
      "identity-document-not-expired",
      "minValidityDays",
    ),
    proofOfAddressMaxAgeMonths: param<number>(
      "proof-of-address-recent",
      "maxAgeMonths",
    ),
    nameMismatchOutcome: param<MismatchOutcome>("name-matches", "onMismatch"),
    dateOfBirthMismatchOutcome: param<MismatchOutcome>(
      "date-of-birth-matches",
      "onMismatch",
    ),
    addressMismatchOutcome: param<MismatchOutcome>(
      "address-matches",
      "onMismatch",
    ),
    certificationParts: param<CertificationPart[]>(
      "certification-complete",
      "requiredParts",
    ),
    requirements: RULE_SPECS.flatMap((spec) => {
      const state = stateOf(spec.id);
      return spec.requirementId && state.enabled
        ? [
            {
              id: spec.requirementId,
              title: requirementTitle(spec.requirementId, state.params),
            },
          ]
        : [];
    }),
    applied: RULE_SPECS.map((spec) => ({
      ruleId: spec.id,
      ...structuredClone(stateOf(spec.id)),
    })),
  };
}

/** Rebuilds the Rulebook a run applied; a run from before Rules applied the Defaults. */
export function rulebookFromApplied(applied: AppliedRule[] | null): Rulebook {
  if (!applied) return resolveRulebook({});
  const states: Partial<Record<RuleId, RuleState>> = {};
  for (const item of applied) {
    if (!isRuleId(item.ruleId)) continue;
    states[item.ruleId] = storedRuleState(ruleSpec(item.ruleId), item);
  }
  return resolveRulebook(states);
}

/** Reads `rules_applied` from the database: a list of AppliedRule, or null. */
export function parseAppliedRules(value: unknown): AppliedRule[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item): AppliedRule[] => {
    if (typeof item !== "object" || item === null) return [];
    const { ruleId, version, enabled, params } = item as Record<
      string,
      unknown
    >;
    if (!isRuleId(ruleId)) return [];
    const state = storedRuleState(ruleSpec(ruleId), {
      version: typeof version === "number" ? version : 0,
      enabled,
      params,
    });
    return [{ ruleId, ...state }];
  });
}
