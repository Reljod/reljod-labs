import {
  type IsoDate,
  parseMrzDate,
  parsePrintedDate,
  subtractMonths,
} from "./dates";
import { addressesCompatible, namesCompatible } from "./matching";
import type { Rulebook } from "./rulebook";
import type {
  ClientDeclaration,
  DocumentKind,
  ExtractedDocument,
  ExtractedField,
  FieldName,
  Outcome,
} from "./types";

export type CheckContext = {
  rulebook: Rulebook;
  prescreenDate: IsoDate;
  declaration: ClientDeclaration;
};

/** `read` is a field nothing is compared against, such as a certifier's name. */
export type FieldCheckOutcome = Outcome | "read";

/** A Field check: one Extracted field marked as soon as its Document is read. */
export type FieldCheck = {
  documentKind: DocumentKind;
  fieldName: FieldName;
  value: string;
  spanRefs: string[];
  outcome: FieldCheckOutcome;
  /** What the value was held against: a declared value or a Rulebook threshold. */
  expected: string | null;
  note: string;
};

type Comparison = Pick<FieldCheck, "outcome" | "expected" | "note">;

/** A reading trusted enough to decide a `Pass` or a `Fail` on. */
export function isUsable(
  field: ExtractedField | undefined,
  rulebook: Rulebook,
): field is ExtractedField {
  return (
    field?.verified === true && field.confidence >= rulebook.minFieldConfidence
  );
}

/** Reads a date field: MRZ expiries in YYMMDD, every other date as printed. */
export function readDate(field: ExtractedField, prescreenDate: IsoDate) {
  return field.name === "mrz_date_of_expiry"
    ? parseMrzDate(field.value, "expiry", prescreenDate)
    : parsePrintedDate(field.value);
}

export function isExpired(expiry: IsoDate, prescreenDate: IsoDate) {
  return expiry < prescreenDate;
}

/** Where a proof of address date sits against the Rulebook's age limit. */
export function proofOfAddressAge(
  date: IsoDate,
  rulebook: Rulebook,
  prescreenDate: IsoDate,
) {
  const cutoff = subtractMonths(
    prescreenDate,
    rulebook.proofOfAddressMaxAgeMonths,
  );
  if (date > prescreenDate) return { status: "future" as const, cutoff };
  if (date < cutoff) return { status: "stale" as const, cutoff };
  return { status: "recent" as const, cutoff };
}

const compared = (
  outcome: FieldCheckOutcome,
  note: string,
  expected: string | null = null,
): Comparison => ({ outcome, note, expected });

/**
 * Holds one usable field against the Client declaration or a Rulebook threshold.
 * Evaluation calls this directly, without the per-field tampering mark.
 */
export function compareField(
  field: ExtractedField,
  context: CheckContext,
): Comparison {
  const { rulebook, prescreenDate, declaration } = context;
  switch (field.name) {
    case "full_name":
      return namesCompatible(field.value, declaration.fullName)
        ? compared("pass", "matches declaration", declaration.fullName)
        : compared(
            "needs_review",
            "differs from declaration",
            declaration.fullName,
          );
    case "date_of_birth": {
      const date = readDate(field, prescreenDate);
      if (!date) return compared("needs_review", "date not recognised");
      return date === declaration.dateOfBirth
        ? compared("pass", "matches declaration", declaration.dateOfBirth)
        : compared("fail", "differs from declaration", declaration.dateOfBirth);
    }
    case "date_of_expiry":
    case "mrz_date_of_expiry": {
      const date = readDate(field, prescreenDate);
      const expected = `on or after ${prescreenDate}`;
      if (!date)
        return compared("needs_review", "date not recognised", expected);
      return isExpired(date, prescreenDate)
        ? compared("fail", `expired ${date}`, expected)
        : compared("pass", `valid until ${date}`, expected);
    }
    case "statement_date": {
      const date = readDate(field, prescreenDate);
      if (!date) return compared("needs_review", "date not recognised");
      const { status, cutoff } = proofOfAddressAge(
        date,
        rulebook,
        prescreenDate,
      );
      const expected = `${cutoff} – ${prescreenDate}`;
      if (status === "future")
        return compared("needs_review", "dated in the future", expected);
      if (status === "stale") {
        return compared(
          "fail",
          `older than ${rulebook.proofOfAddressMaxAgeMonths} months`,
          expected,
        );
      }
      return compared("pass", "recent enough", expected);
    }
    case "address":
      return addressesCompatible(field.value, declaration.residentialAddress)
        ? compared(
            "pass",
            "matches declaration",
            declaration.residentialAddress,
          )
        : compared(
            "needs_review",
            "differs from declaration",
            declaration.residentialAddress,
          );
    default:
      return compared("read", "read");
  }
}

/**
 * The Field check for one field. Evaluation uses the same comparisons, so a field
 * marked `Pass` here never sits under a Finding that says otherwise.
 */
export function checkField(
  document: ExtractedDocument,
  field: ExtractedField,
  context: CheckContext,
): FieldCheck {
  const base = {
    documentKind: document.kind,
    fieldName: field.name,
    value: field.value,
    spanRefs: field.spanRefs,
  };
  const tampered = new Set(document.judgments.tamperingSpanRefs);
  if (field.spanRefs.some((ref) => tampered.has(ref))) {
    return {
      ...base,
      outcome: "needs_review",
      expected: null,
      note: "possible tampering",
    };
  }
  if (!field.verified) {
    return {
      ...base,
      outcome: "needs_review",
      expected: null,
      note: "not found in source",
    };
  }
  if (!isUsable(field, context.rulebook)) {
    return {
      ...base,
      outcome: "needs_review",
      expected: null,
      note: "low confidence",
    };
  }
  return { ...base, ...compareField(field, context) };
}

export function fieldChecks(
  document: ExtractedDocument,
  context: CheckContext,
): FieldCheck[] {
  return document.fields.map((field) => checkField(document, field, context));
}
