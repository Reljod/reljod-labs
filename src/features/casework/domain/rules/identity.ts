import { ageOn, daysBetween, formatDate, isoDate } from "../dates";
import { nameWords, sameName, surnameChanged } from "../names";
import { RULEBOOK } from "../rulebook";
import {
  type Check,
  documentsOf,
  flag,
  names,
  type RunDocument,
  type RunState,
  text,
} from "../run-state";
import type { JobOutcome } from "./types";

type Record = {
  document: RunDocument;
  name: string;
  dateOfBirth: string;
  otherNames: string[];
};

/** The person the case is about, from the most authoritative record present. */
export function subjectRecord(state: RunState): Record | null {
  const sources: [
    Parameters<typeof documentsOf>[1],
    string,
    string,
    string?,
  ][] = [
    ["member_statement", "member_name", "date_of_birth"],
    ["customer_profile", "customer_name", "date_of_birth", "other_names"],
    ["withdrawal_request_form", "member_name", "date_of_birth"],
  ];
  for (const [kind, nameField, dobField, aliasField] of sources) {
    const document = documentsOf(state, kind).find((item) => item.fields);
    if (!document) continue;
    const name = text(document, nameField);
    if (!name) continue;
    return {
      document,
      name,
      dateOfBirth: text(document, dobField),
      otherNames: aliasField ? names(document, aliasField) : [],
    };
  }
  return null;
}

/** True when a marriage certificate links the two names. */
function marriageLinks(state: RunState, a: string, b: string) {
  return documentsOf(state, "marriage_certificate").some((certificate) => {
    const parties = [
      text(certificate, "party_one_name"),
      text(certificate, "party_two_name"),
    ];
    const surnames = parties.flatMap((party) => nameWords(party).slice(-1));
    const all = [...nameWords(a), ...nameWords(b)];
    return (
      parties.some((party) => sameName(party, a) || sameName(party, b)) &&
      surnames.every((surname) => all.includes(surname) || surnames.length > 1)
    );
  });
}

function worst(outcomes: Check["outcome"][]): Check["outcome"] {
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("review")) return "review";
  return "pass";
}

/** Expiry and certification for one ID. */
function idChecks(id: RunDocument, asOf: string) {
  const holder = text(id, "full_name") || id.name;
  const expiry = isoDate(text(id, "date_of_expiry"));
  const inDate: Pick<Check, "outcome" | "detail"> = !expiry
    ? { outcome: "review", detail: `No expiry date read on ${holder}'s ID` }
    : expiry >= asOf
      ? {
          outcome: "pass",
          detail: `${holder}'s ID expires ${formatDate(expiry)}`,
        }
      : {
          outcome: "fail",
          detail: `${holder}'s ID expired ${formatDate(expiry)}, before the review on ${formatDate(asOf)}`,
        };

  let certified: Pick<Check, "outcome" | "detail">;
  if (!flag(id, "certified")) {
    certified = {
      outcome: "review",
      detail: `${holder}'s ID is not a certified copy`,
    };
  } else {
    const missing = [
      ["certifier_name", "certifier's name"],
      ["certifier_occupation", "certifier's occupation"],
      ["certification_date", "certification date"],
    ].flatMap(([field, label]) => (text(id, field) ? [] : [label]));
    const date = isoDate(text(id, "certification_date"));
    const age = date ? daysBetween(date, asOf) : 0;
    certified =
      missing.length > 0
        ? {
            outcome: "fail",
            detail: `Certification on ${holder}'s ID is missing the ${missing.join(" and ")}`,
          }
        : age > RULEBOOK.certificationMaxAgeDays
          ? {
              outcome: "fail",
              detail: `${holder}'s ID was certified ${formatDate(date ?? "")}, ${age} days before the review (limit ${RULEBOOK.certificationMaxAgeDays})`,
            }
          : {
              outcome: "pass",
              detail: `Certified by ${text(id, "certifier_name")}, ${text(id, "certifier_occupation")}, on ${formatDate(date ?? "")}`,
            };
  }
  return { inDate, certified };
}

/**
 * match_identity: the ID against the record, then every ID's expiry and
 * certification. Without a record (a structure), only the IDs are checked.
 */
export function matchIdentity(state: RunState): JobOutcome {
  const ids = documentsOf(state, "identity_document").filter((id) => id.fields);
  const record = subjectRecord(state);
  const checks: Check[] = [];
  let question: JobOutcome["question"];

  let primary = ids[0];
  if (record) {
    primary =
      ids.find((id) =>
        [record.name, ...record.otherNames].some((name) =>
          sameName(text(id, "full_name"), name),
        ),
      ) ?? ids[0];
  }

  if (record && primary) {
    const idName = text(primary, "full_name");
    const idDob = isoDate(text(primary, "date_of_birth"));
    const recordDob = isoDate(record.dateOfBirth);
    const nameMatches = [record.name, ...record.otherNames].some((name) =>
      sameName(idName, name),
    );
    const dobMatches = !idDob || !recordDob || idDob === recordDob;
    const evidence = [
      { documentId: primary.id, field: "full_name" },
      { documentId: record.document.id, field: "date_of_birth" },
    ];
    if (!dobMatches) {
      checks.push({
        id: "identity_matches_record",
        outcome: "review",
        detail: `Date of birth differs: ID ${formatDate(idDob ?? "")}, ${record.document.kind?.replaceAll("_", " ")} ${formatDate(recordDob ?? "")}`,
        job: "match_identity",
        evidence,
      });
    } else if (nameMatches) {
      checks.push({
        id: "identity_matches_record",
        outcome: "pass",
        detail: `${idName} matches the record${idDob ? `, born ${formatDate(idDob)}` : ""}`,
        job: "match_identity",
        evidence,
      });
    } else if (surnameChanged(idName, record.name)) {
      const linked = marriageLinks(state, idName, record.name);
      if (!linked) {
        question = {
          prompt: `The ID says ${idName} but the record says ${record.name}. Is there a marriage certificate or deed poll that links them?`,
          kinds: ["marriage_certificate"],
        };
      }
      checks.push({
        id: "identity_matches_record",
        outcome: linked ? "pass" : "review",
        detail: linked
          ? `ID in ${idName}, record in ${record.name}: the marriage certificate links the names`
          : `ID in ${idName}, record in ${record.name}: only the surname differs, and nothing explains the change`,
        job: "match_identity",
        evidence,
      });
    } else {
      checks.push({
        id: "identity_matches_record",
        outcome: "fail",
        detail: `ID is in the name ${idName}; the record is ${record.name}`,
        job: "match_identity",
        evidence,
      });
    }
  }

  const perId = ids.map((id) => idChecks(id, state.asOf));
  if (perId.length > 0) {
    const pick = (key: "inDate" | "certified") => {
      const outcome = worst(perId.map((item) => item[key].outcome));
      const detail =
        perId.find((item) => item[key].outcome === outcome)?.[key].detail ?? "";
      return { outcome, detail };
    };
    checks.push(
      {
        id: "id_in_date",
        ...pick("inDate"),
        job: "match_identity",
        evidence: ids.map((id) => ({
          documentId: id.id,
          field: "date_of_expiry",
        })),
      },
      {
        id: "id_certified",
        ...pick("certified"),
        job: "match_identity",
        evidence: ids.map((id) => ({ documentId: id.id, field: "certified" })),
      },
    );
  }

  const identityCheck = checks.find(
    (check) => check.id === "identity_matches_record",
  );
  return {
    checks,
    question,
    summary: identityCheck
      ? identityCheck.detail
      : `${ids.length} ID${ids.length === 1 ? "" : "s"} checked`,
  };
}

/** Age of the subject on the review date, when a date of birth is known. */
export function subjectAge(state: RunState) {
  const record = subjectRecord(state);
  const dob = isoDate(record?.dateOfBirth);
  return dob ? ageOn(dob, state.asOf) : null;
}
