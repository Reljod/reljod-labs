import { describe, expect, it } from "vitest";
import { findPack, type Pack } from "../packs";
import { evaluate } from "./evaluate";
import { fieldChecks } from "./field-checks";
import { individualOnboarding, type Rulebook } from "./rulebook";
import { defaultRuleStates, type RuleId, resolveRulebook } from "./rules";
import type {
  DocumentJudgments,
  DocumentKind,
  ExtractedDocument,
  FieldName,
  FieldReading,
  Span,
} from "./types";
import { verifyReading } from "./verify";

type Readings = Partial<Record<FieldName, string>>;

/** A Document as a perfect model would read it: one Span per printed value. */
function document(
  kind: DocumentKind,
  readings: Readings,
  judgments: Partial<DocumentJudgments> = {},
  confidence = 0.95,
): ExtractedDocument {
  const spans: Span[] = [];
  const fields = Object.entries(readings).map(([name, value]) => {
    const ref = `p1-${name}`;
    spans.push({
      ref,
      page: 1,
      text:
        name === "mrz_date_of_expiry"
          ? `MR48201732MRD9103144F${value}6<<`
          : value,
      granularity: "line",
      box: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.15 },
      confidence: 0.98,
    });
    const reading: FieldReading = {
      name: name as FieldName,
      value,
      spanRefs: [ref],
      confidence,
    };
    return reading;
  });
  return {
    kind,
    spans,
    fields: fields.map((reading) => verifyReading(reading, spans)),
    judgments: {
      legible: true,
      tamperingSuspected: false,
      tamperingSpanRefs: [],
      signaturePresent: kind === "certified_copy" ? true : null,
      notes: "",
      ...judgments,
    },
  };
}

const passport: Readings = {
  full_name: "AMARA LUCIA VELASCO",
  date_of_birth: "14 MAR 1991",
  date_of_issue: "10 MAY 2022",
  date_of_expiry: "09 MAY 2032",
  mrz_date_of_expiry: "320509",
};

const bill: Readings = {
  full_name: "Amara L. Velasco",
  statement_date: "02 Oct 2026",
  address: "14 Harbour View Road Port Selene MR-2041 Republic of Meridia",
};

const certification: Readings = {
  certification_wording:
    "I certify that this is a true copy of the original document, which I have seen.",
  certifier_name: "Daniel K. Ortez",
  certifier_occupation: "Notary Public",
  certification_date: "20 Oct 2026",
};

/** Ideal extractions for each preset pack, mirroring its deliberate flaw. */
const idealExtractions: Record<string, ExtractedDocument[]> = {
  clean: [
    document("identity_document", passport),
    document("proof_of_address", bill),
    document("certified_copy", { ...passport, ...certification }),
  ],
  "expired-passport": [
    document("identity_document", {
      ...passport,
      date_of_expiry: "30 AUG 2026",
      mrz_date_of_expiry: "260830",
    }),
    document("proof_of_address", bill),
    document("certified_copy", {
      ...passport,
      date_of_expiry: "30 AUG 2026",
      ...certification,
    }),
  ],
  "stale-bill": [
    document("identity_document", passport),
    document("proof_of_address", { ...bill, statement_date: "15 Jun 2026" }),
    document("certified_copy", { ...passport, ...certification }),
  ],
  "name-mismatch": [
    document("identity_document", passport),
    document("proof_of_address", { ...bill, full_name: "Marisol Velasco" }),
    document("certified_copy", { ...passport, ...certification }),
  ],
  "tampered-passport": [
    document(
      "identity_document",
      {
        ...passport,
        date_of_expiry: "11 SEP 2029",
        mrz_date_of_expiry: "250911",
      },
      {
        tamperingSuspected: true,
        tamperingSpanRefs: ["p1-date_of_expiry"],
        notes:
          "The expiry date is printed in a different font on a white patch.",
      },
    ),
    document("proof_of_address", bill),
    document("certified_copy", { ...passport, ...certification }),
  ],
  "incomplete-certification": [
    document("identity_document", passport),
    document("proof_of_address", bill),
    document("certified_copy", {
      ...passport,
      certification_wording: certification.certification_wording,
      certifier_name: certification.certifier_name,
    }),
  ],
};

function prescreen(
  pack: Pack,
  documents: ExtractedDocument[],
  rulebook: Rulebook = individualOnboarding,
) {
  return evaluate({
    rulebook,
    prescreenDate: pack.prescreenDate,
    declaration: pack.clientDeclaration,
    documents,
  });
}

describe("evaluate against the preset packs", () => {
  it.each(
    Object.keys(idealExtractions),
  )("%s produces its expected Findings", (slug) => {
    const pack = findPack(slug);
    if (!pack) throw new Error(`Unknown pack ${slug}`);
    const findings = prescreen(pack, idealExtractions[slug]);
    expect(
      findings.map(({ requirementId, outcome }) => ({
        requirementId,
        outcome,
      })),
    ).toEqual(pack.expectedFindings);
  });
});

describe("Field checks agree with Findings", () => {
  /** Requirements decided by comparing a field, and the fields they compare. */
  const compared: Partial<Record<string, FieldName[]>> = {
    "identity-document-not-expired": ["date_of_expiry", "mrz_date_of_expiry"],
    "proof-of-address-recent": ["statement_date"],
    "name-matches": ["full_name"],
    "date-of-birth-matches": ["date_of_birth"],
    "address-matches": ["address"],
  };

  it.each(
    Object.keys(idealExtractions),
  )("%s marks compared fields the way their Finding decides", (slug) => {
    const pack = findPack(slug);
    if (!pack) throw new Error(`Unknown pack ${slug}`);
    const documents = idealExtractions[slug];
    const checks = documents.flatMap((item) =>
      fieldChecks(item, {
        rulebook: individualOnboarding,
        prescreenDate: pack.prescreenDate,
        declaration: pack.clientDeclaration,
      }),
    );

    for (const finding of prescreen(pack, documents)) {
      const names = compared[finding.requirementId];
      if (!names) continue;
      const outcomes = checks
        .filter((check) => names.includes(check.fieldName))
        .map((check) => check.outcome);
      if (finding.outcome === "pass") {
        expect(outcomes.every((outcome) => outcome === "pass")).toBe(true);
      } else {
        expect(outcomes).toContain(finding.outcome);
      }
    }
  });

  it("marks a field on a tampered Span as needs_review", () => {
    const [identity] = idealExtractions["tampered-passport"];
    const pack = findPack("tampered-passport") as Pack;
    const expiry = fieldChecks(identity, {
      rulebook: individualOnboarding,
      prescreenDate: pack.prescreenDate,
      declaration: pack.clientDeclaration,
    }).find((check) => check.fieldName === "date_of_expiry");
    expect(expiry).toMatchObject({
      outcome: "needs_review",
      note: "possible tampering",
    });
  });
});

describe("evaluate safeguards", () => {
  const pack = findPack("expired-passport") as Pack;
  const outcomeOf = (documents: ExtractedDocument[], id: string) =>
    prescreen(pack, documents).find((finding) => finding.requirementId === id)
      ?.outcome;

  it("downgrades a clear violation to needs_review when confidence is low", () => {
    const documents = [
      document(
        "identity_document",
        {
          ...passport,
          date_of_expiry: "30 AUG 2026",
          mrz_date_of_expiry: "260830",
        },
        {},
        0.4,
      ),
    ];
    expect(outcomeOf(documents, "identity-document-not-expired")).toBe(
      "needs_review",
    );
  });

  it("downgrades a reading its spans do not support to needs_review", () => {
    const identity = document("identity_document", {
      ...passport,
      date_of_expiry: "30 AUG 2026",
      mrz_date_of_expiry: "260830",
    });
    identity.fields = identity.fields.map((field) =>
      field.name === "date_of_expiry" ? { ...field, verified: false } : field,
    );
    expect(outcomeOf([identity], "identity-document-not-expired")).toBe(
      "needs_review",
    );
  });

  it("fails a pack with no identity document", () => {
    expect(outcomeOf([], "identity-document-present")).toBe("fail");
  });

  it("fails a dated-of-birth mismatch read with confidence", () => {
    const documents = [
      document("identity_document", {
        ...passport,
        date_of_birth: "14 MAR 1992",
      }),
    ];
    expect(outcomeOf(documents, "date-of-birth-matches")).toBe("fail");
  });

  it("cites the evidence behind each finding", () => {
    const findings = prescreen(pack, idealExtractions["expired-passport"]);
    const expiry = findings.find(
      (finding) => finding.requirementId === "identity-document-not-expired",
    );
    expect(expiry?.evidence).toEqual([
      {
        documentKind: "identity_document",
        fieldName: "date_of_expiry",
        spanRefs: ["p1-date_of_expiry"],
      },
      {
        documentKind: "identity_document",
        fieldName: "mrz_date_of_expiry",
        spanRefs: ["p1-mrz_date_of_expiry"],
      },
    ]);
  });
});

describe("evaluate with edited Rules", () => {
  /** The Rulebook with one Rule's Parameters (or switch) changed. */
  function edited(
    id: RuleId,
    params: Record<string, unknown>,
    enabled = true,
  ): Rulebook {
    const states = defaultRuleStates();
    states[id] = {
      version: 1,
      enabled,
      params: { ...states[id].params, ...params } as never,
    };
    return resolveRulebook(states);
  }
  const outcome = (
    slug: string,
    rulebook: Rulebook,
    id: string,
    documents = idealExtractions[slug],
  ) =>
    prescreen(findPack(slug) as Pack, documents, rulebook).find(
      (finding) => finding.requirementId === id,
    )?.outcome;

  it("matches the shipped Rulebook at the Defaults", () => {
    expect(resolveRulebook(defaultRuleStates())).toEqual(individualOnboarding);
  });

  it("fails an identity document that expires inside the validity window", () => {
    const soon = [
      document("identity_document", {
        ...passport,
        date_of_expiry: "30 DEC 2026",
        mrz_date_of_expiry: "261230",
      }),
      ...idealExtractions.clean.slice(1),
    ];
    const id = "identity-document-not-expired";
    expect(outcome("clean", individualOnboarding, id, soon)).toBe("pass");
    expect(
      outcome("clean", edited(id, { minValidityDays: 90 }), id, soon),
    ).toBe("fail");
  });

  it("lets an older proof of address pass when the Rule allows it", () => {
    const id = "proof-of-address-recent";
    expect(outcome("stale-bill", individualOnboarding, id)).toBe("fail");
    expect(outcome("stale-bill", edited(id, { maxAgeMonths: 6 }), id)).toBe(
      "pass",
    );
  });

  it("fails a differing name when the Rule says so", () => {
    const id = "name-matches";
    expect(outcome("name-mismatch", individualOnboarding, id)).toBe(
      "needs_review",
    );
    expect(
      outcome("name-mismatch", edited(id, { onMismatch: "fail" }), id),
    ).toBe("fail");
  });

  it("keeps an unreadable name at needs_review even when mismatches fail", () => {
    const blurred = [
      document("identity_document", passport, {}, 0.4),
      ...idealExtractions.clean.slice(1),
    ];
    const id = "name-matches";
    expect(
      outcome("clean", edited(id, { onMismatch: "fail" }), id, blurred),
    ).toBe("needs_review");
  });

  it("asks a certification only for the parts the Rule requires", () => {
    const id = "certification-complete";
    expect(outcome("incomplete-certification", individualOnboarding, id)).toBe(
      "fail",
    );
    expect(
      outcome(
        "incomplete-certification",
        edited(id, { requiredParts: ["wording", "certifier_name"] }),
        id,
      ),
    ).toBe("pass");
  });

  it("makes no Finding for a Rule that is switched off", () => {
    const findings = prescreen(
      findPack("tampered-passport") as Pack,
      idealExtractions["tampered-passport"],
      edited("no-tampering", {}, false),
    );
    expect(findings.map((finding) => finding.requirementId)).not.toContain(
      "no-tampering",
    );
    expect(findings).toHaveLength(9);
  });

  it("gives the Field check the outcome the Finding uses", () => {
    const rulebook = edited("name-matches", { onMismatch: "fail" });
    const pack = findPack("name-mismatch") as Pack;
    const bill = idealExtractions["name-mismatch"][1];
    const check = fieldChecks(bill, {
      rulebook,
      prescreenDate: pack.prescreenDate,
      declaration: pack.clientDeclaration,
    }).find((item) => item.fieldName === "full_name");
    expect(check?.outcome).toBe("fail");
  });
});
