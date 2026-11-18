import { formatMinor, parseMoney } from "../../domain/money";
import {
  type ParamDef,
  type ParamKind,
  type Params,
  type RuleDef,
  validateParams,
} from "../../domain/rules";

/**
 * A Rule's Parameters as a person edits them: text for every number (so a
 * half-typed amount is not lost), booleans for flags. `fromDraft` reads them
 * back into Parameters and says, per field, what it could not read; the
 * Rule's own `validateParams` then checks ranges and relations.
 */
export type Draft = Record<string, string | boolean>;

/** What follows a number in its field. */
export const UNIT: Partial<Record<ParamKind, string>> = {
  money: "MRF",
  percent: "%",
  bps: "% a year",
  hours: "hours",
  days: "days",
  months: "months",
  hour: ":00",
};

export function toDraft(fields: ParamDef[], params: Params): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    const value = params[field.key];
    if (field.kind === "flag") draft[field.key] = value === true;
    else if (field.kind === "words") {
      draft[field.key] = Array.isArray(value) ? value.join(", ") : "";
    } else {
      const number = typeof value === "number" ? value : 0;
      draft[field.key] =
        field.kind === "money"
          ? formatMinor(number)
          : field.kind === "bps"
            ? (number / 100).toFixed(2)
            : String(number);
    }
  }
  return draft;
}

export type ReadDraft = {
  /** The Parameters that could be read; a field that could not keeps its value out. */
  params: Params;
  errors: Record<string, string>;
};

export function fromDraft(fields: ParamDef[], draft: Draft): ReadDraft {
  const params: Params = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = draft[field.key];
    if (field.kind === "flag") {
      params[field.key] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (field.kind === "words") {
      params[field.key] = text
        .split(",")
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length > 0);
      continue;
    }
    if (field.kind === "money") {
      const minor = parseMoney(text);
      if (minor === null) {
        errors[field.key] = "Type an amount in florins, like 1,250.00.";
      } else params[field.key] = minor;
      continue;
    }
    if (field.kind === "bps") {
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        errors[field.key] =
          "Type a percent with at most two decimals, like 2.25.";
      } else params[field.key] = Math.round(Number(text) * 100);
      continue;
    }
    if (!/^\d+$/.test(text)) {
      errors[field.key] = "Type a whole number.";
    } else params[field.key] = Number(text);
  }
  return { params, errors };
}

/** The draft read and checked: every field's error, the client's first then the Rule's. */
export function checkDraft(def: RuleDef, draft: Draft): ReadDraft {
  const read = fromDraft(def.params, draft);
  if (Object.keys(read.errors).length > 0) return read;
  const checked = validateParams(def, read.params);
  if ("errors" in checked) {
    const errors: Record<string, string> = {};
    for (const error of checked.errors) errors[error.field] ??= error.message;
    return { params: read.params, errors };
  }
  return { params: checked.params, errors: {} };
}

/** Whether two sets of Parameters say the same thing. */
export function sameParams(fields: ParamDef[], a: Params, b: Params): boolean {
  return fields.every(
    (field) => JSON.stringify(a[field.key]) === JSON.stringify(b[field.key]),
  );
}
