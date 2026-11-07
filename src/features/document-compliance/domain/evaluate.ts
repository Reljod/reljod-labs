import {
  type IsoDate,
  parseMrzDate,
  parsePrintedDate,
  subtractMonths,
} from "./dates";
import { addressesCompatible, namesCompatible } from "./matching";
import type { RequirementId, Rulebook } from "./rulebook";
import type {
  ClientDeclaration,
  DocumentKind,
  Evidence,
  ExtractedDocument,
  ExtractedField,
  FieldName,
  Finding,
  Outcome,
} from "./types";

export type PrescreenInput = {
  rulebook: Rulebook;
  prescreenDate: IsoDate;
  declaration: ClientDeclaration;
  documents: ExtractedDocument[];
};

const KIND_LABELS: Record<DocumentKind, string> = {
  identity_document: "identity document",
  proof_of_address: "proof of address",
  certified_copy: "certified copy",
};

type Result = { outcome: Outcome; reason: string; evidence: Evidence[] };

const pass = (reason: string, evidence: Evidence[] = []): Result => ({
  outcome: "pass",
  reason,
  evidence,
});
const fail = (reason: string, evidence: Evidence[] = []): Result => ({
  outcome: "fail",
  reason,
  evidence,
});
const review = (reason: string, evidence: Evidence[] = []): Result => ({
  outcome: "needs_review",
  reason,
  evidence,
});

function fieldOf(document: ExtractedDocument | undefined, name: FieldName) {
  return document?.fields.find((field) => field.name === name);
}

function evidenceOf(
  document: ExtractedDocument,
  field?: ExtractedField,
): Evidence {
  return {
    documentKind: document.kind,
    fieldName: field?.name ?? null,
    spanRefs: field?.spanRefs ?? [],
  };
}

/** Evaluates every Requirement in the Rulebook against the extracted Document pack. */
export function evaluate(input: PrescreenInput): Finding[] {
  const { rulebook, prescreenDate, declaration, documents } = input;
  const documentOf = (kind: DocumentKind) =>
    documents.find((document) => document.kind === kind);
  const usable = (field: ExtractedField | undefined): field is ExtractedField =>
    field?.verified === true && field.confidence >= rulebook.minFieldConfidence;

  function present(kind: DocumentKind, keyFields: FieldName[]): Result {
    const document = documentOf(kind);
    const label = KIND_LABELS[kind];
    if (!document) return fail(`The pack has no ${label}.`);
    const readable = keyFields
      .map((name) => fieldOf(document, name))
      .filter(usable);
    if (readable.length === 0) {
      return review(
        `A ${label} was submitted but its key details could not be read reliably.`,
        [evidenceOf(document)],
      );
    }
    return pass(
      `A ${label} is present.`,
      readable.map((field) => evidenceOf(document, field)),
    );
  }

  function notExpired(): Result {
    const document = documentOf("identity_document");
    if (!document) return fail("The pack has no identity document.");
    const printed = fieldOf(document, "date_of_expiry");
    const mrz = fieldOf(document, "mrz_date_of_expiry");
    const evidence = [printed, mrz]
      .filter((field) => field !== undefined)
      .map((field) => evidenceOf(document, field));

    const readings = [
      { field: printed, label: "printed expiry", parse: parsePrintedDate },
      {
        field: mrz,
        label: "machine-readable expiry",
        parse: (value: string) => parseMrzDate(value, "expiry", prescreenDate),
      },
    ].filter((reading) => reading.field !== undefined);
    if (readings.length === 0) {
      return review("No expiry date was found on the identity document.", [
        evidenceOf(document),
      ]);
    }

    const dates: { label: string; date: IsoDate }[] = [];
    for (const { field, label, parse } of readings) {
      const date = usable(field) ? parse(field.value) : null;
      if (!date) {
        return review(`The ${label} could not be read reliably.`, evidence);
      }
      dates.push({ label, date });
    }

    if (new Set(dates.map(({ date }) => date)).size > 1) {
      const detail = dates
        .map(({ label, date }) => `${label} ${date}`)
        .join(", ");
      return review(
        `The expiry dates on the document disagree (${detail}).`,
        evidence,
      );
    }

    const expiry = dates[0].date;
    if (expiry < prescreenDate) {
      return fail(`The identity document expired on ${expiry}.`, evidence);
    }
    return pass(`The identity document is valid until ${expiry}.`, evidence);
  }

  function recentProofOfAddress(): Result {
    const document = documentOf("proof_of_address");
    if (!document) return fail("The pack has no proof of address.");
    const field = fieldOf(document, "statement_date");
    const date = usable(field) ? parsePrintedDate(field.value) : null;
    if (!field || !date) {
      return review("The proof of address date could not be read reliably.", [
        evidenceOf(document, field),
      ]);
    }
    const evidence = [evidenceOf(document, field)];
    const months = rulebook.proofOfAddressMaxAgeMonths;
    const cutoff = subtractMonths(prescreenDate, months);
    if (date > prescreenDate) {
      return review(
        `The proof of address is dated in the future (${date}).`,
        evidence,
      );
    }
    if (date < cutoff) {
      return fail(
        `The proof of address is dated ${date}, more than ${months} months before ${prescreenDate}.`,
        evidence,
      );
    }
    return pass(`The proof of address is dated ${date}.`, evidence);
  }

  function nameMatches(): Result {
    const evidence: Evidence[] = [];
    const problems: string[] = [];
    for (const document of documents) {
      const label = KIND_LABELS[document.kind];
      const field = fieldOf(document, "full_name");
      evidence.push(evidenceOf(document, field));
      if (!usable(field)) {
        problems.push(`the name on the ${label} could not be read reliably`);
      } else if (!namesCompatible(field.value, declaration.fullName)) {
        problems.push(
          `the ${label} names "${field.value}", not "${declaration.fullName}"`,
        );
      }
    }
    if (problems.length > 0) {
      return review(`Check the name: ${problems.join("; ")}.`, evidence);
    }
    return pass(
      `Every document names ${declaration.fullName} or a consistent variant.`,
      evidence,
    );
  }

  function dateOfBirthMatches(): Result {
    const evidence: Evidence[] = [];
    let mismatch: string | null = null;
    for (const document of documents) {
      const field = fieldOf(document, "date_of_birth");
      if (!field) continue;
      evidence.push(evidenceOf(document, field));
      const date = usable(field) ? parsePrintedDate(field.value) : null;
      if (!date) {
        return review(
          `The date of birth on the ${KIND_LABELS[document.kind]} could not be read reliably.`,
          evidence,
        );
      }
      if (date !== declaration.dateOfBirth) {
        mismatch = `the ${KIND_LABELS[document.kind]} shows ${date}`;
      }
    }
    if (evidence.length === 0) {
      return review("No document shows a date of birth.");
    }
    if (mismatch) {
      return fail(
        `The declared date of birth is ${declaration.dateOfBirth} but ${mismatch}.`,
        evidence,
      );
    }
    return pass(
      `The date of birth matches the declared ${declaration.dateOfBirth}.`,
      evidence,
    );
  }

  function addressMatches(): Result {
    const document = documentOf("proof_of_address");
    if (!document) return fail("The pack has no proof of address.");
    const field = fieldOf(document, "address");
    const evidence = [evidenceOf(document, field)];
    if (!usable(field)) {
      return review(
        "The address on the proof of address could not be read reliably.",
        evidence,
      );
    }
    if (!addressesCompatible(field.value, declaration.residentialAddress)) {
      return review(
        `The proof of address shows "${field.value}", which differs from the declared address.`,
        evidence,
      );
    }
    return pass("The address matches the declared address.", evidence);
  }

  function certificationComplete(): Result {
    const document = documentOf("certified_copy");
    if (!document) return fail("The pack has no certified copy.");
    const parts: { name: FieldName; label: string }[] = [
      { name: "certification_wording", label: "certification wording" },
      { name: "certifier_name", label: "certifier's name" },
      { name: "certifier_occupation", label: "certifier's occupation" },
      { name: "certification_date", label: "certification date" },
    ];
    const evidence: Evidence[] = [];
    const missing: string[] = [];
    const unclear: string[] = [];
    for (const { name, label } of parts) {
      const field = fieldOf(document, name);
      if (!field || field.value.trim() === "") {
        missing.push(label);
        continue;
      }
      evidence.push(evidenceOf(document, field));
      if (!usable(field)) unclear.push(label);
    }
    const signature = document.judgments.signaturePresent;
    if (signature === false) missing.push("signature");
    if (missing.length > 0) {
      return fail(
        `The certification is missing the ${missing.join(", ")}.`,
        evidence.length > 0 ? evidence : [evidenceOf(document)],
      );
    }
    if (unclear.length > 0 || signature === null) {
      const items = signature === null ? [...unclear, "signature"] : unclear;
      return review(
        `Parts of the certification could not be read reliably: ${items.join(", ")}.`,
        evidence,
      );
    }
    return pass(
      "The certification has wording, certifier name, occupation, date and signature.",
      evidence,
    );
  }

  function legible(): Result {
    const unreadable = documents.filter(
      (document) => !document.judgments.legible,
    );
    if (unreadable.length > 0) {
      return review(
        `Check legibility of the ${unreadable.map((document) => KIND_LABELS[document.kind]).join(", ")}.`,
        unreadable.map((document) => evidenceOf(document)),
      );
    }
    return pass("Every document is legible.");
  }

  function noTampering(): Result {
    const suspicious = documents.filter(
      (document) => document.judgments.tamperingSuspected,
    );
    if (suspicious.length > 0) {
      return review(
        suspicious
          .map(
            (document) =>
              `Possible tampering on the ${KIND_LABELS[document.kind]}: ${document.judgments.notes}`,
          )
          .join(" "),
        suspicious.map((document) => ({
          documentKind: document.kind,
          fieldName: null,
          spanRefs: document.judgments.tamperingSpanRefs,
        })),
      );
    }
    return pass("No document shows signs of tampering.");
  }

  const rules: Record<RequirementId, () => Result> = {
    "identity-document-present": () =>
      present("identity_document", ["full_name", "date_of_expiry"]),
    "identity-document-not-expired": notExpired,
    "proof-of-address-present": () =>
      present("proof_of_address", ["full_name", "address"]),
    "proof-of-address-recent": recentProofOfAddress,
    "name-matches": nameMatches,
    "date-of-birth-matches": dateOfBirthMatches,
    "address-matches": addressMatches,
    "certification-complete": certificationComplete,
    "documents-legible": legible,
    "no-tampering": noTampering,
  };

  return rulebook.requirements.map(({ id }) => ({
    requirementId: id,
    ...rules[id](),
  }));
}
