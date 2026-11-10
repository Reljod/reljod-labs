import { formatDate, isoDate } from "../dates";
import { sameName, words } from "../names";
import {
  type Check,
  documentsOf,
  firstOf,
  list,
  names,
  type RunState,
  text,
} from "../run-state";
import type { JobOutcome } from "./types";

const SUFFIXES = new Set([
  "ltd",
  "limited",
  "llc",
  "inc",
  "lp",
  "l",
  "p",
  "the",
  "co",
  "company",
  "corp",
]);

/** A company name without its legal suffix or punctuation. */
export function companyKey(name: string) {
  return words(name)
    .filter((word) => !SUFFIXES.has(word))
    .join(" ");
}

const sameCompany = (a: string, b: string) => companyKey(a) === companyKey(b);

/** verify_entity: the company's papers agree, the licence is live, signatories are authorised. */
export function verifyEntity(state: RunState): JobOutcome {
  const checks: Check[] = [];
  const certificate = firstOf(state, "certificate_of_incorporation");
  const application = firstOf(state, "employer_application");
  const licence = firstOf(state, "trade_business_licence");
  const resolution = firstOf(state, "authorised_signatories");
  const directorRegisters = documentsOf(state, "register_of_directors").filter(
    (document) => document.fields,
  );

  const legalName =
    text(certificate, "entity_name") || text(application, "employer_name");
  if (certificate) {
    const problems: string[] = [];
    const evidence: Check["evidence"] = [
      { documentId: certificate.id, field: "entity_name" },
    ];
    if (application) {
      const applied = text(application, "employer_name");
      if (applied && !sameCompany(applied, legalName)) {
        problems.push(
          `the application is in the name ${applied}, the certificate ${legalName}`,
        );
      }
      const number = text(application, "registration_number");
      const certified = text(certificate, "registration_number");
      if (
        number &&
        certified &&
        number.replace(/\W/g, "") !== certified.replace(/\W/g, "")
      ) {
        problems.push(
          `registration number ${number} on the application, ${certified} on the certificate`,
        );
      }
      evidence.push({ documentId: application.id, field: "employer_name" });
    }
    const related = [
      ...directorRegisters,
      ...documentsOf(state, "authorised_signatories"),
    ];
    for (const document of related) {
      const name = text(document, "entity_name");
      // Registers may belong to other companies in the chain; only compare likely matches.
      if (
        name &&
        !sameCompany(name, legalName) &&
        companyKey(name).split(" ")[0] === companyKey(legalName).split(" ")[0]
      ) {
        problems.push(
          `the ${document.kind?.replaceAll("_", " ")} names ${name}`,
        );
      }
    }
    if (licence) {
      const licensee = text(licence, "licensee_name");
      if (
        licensee &&
        !sameCompany(licensee, legalName) &&
        !sameCompany(licensee, text(application, "trade_name"))
      ) {
        problems.push(`the licence is held by ${licensee}`);
      }
    }
    checks.push({
      id: "entity_documents_consistent",
      outcome: problems.length === 0 ? "pass" : "fail",
      detail:
        problems.length === 0
          ? `${legalName} (${text(certificate, "registration_number")}) agrees across ${1 + related.length + (application ? 1 : 0)} documents`
          : `${problems.join("; ").replace(/^./, (c) => c.toUpperCase())}`,
      job: "verify_entity",
      evidence,
    });
  }

  if (licence) {
    const expiry = isoDate(text(licence, "expiry_date"));
    checks.push({
      id: "licence_in_date",
      outcome: !expiry ? "review" : expiry >= state.asOf ? "pass" : "fail",
      detail: !expiry
        ? "No expiry date on the trade licence"
        : expiry >= state.asOf
          ? `Licence ${text(licence, "licence_number")} runs to ${formatDate(expiry)}`
          : `Licence ${text(licence, "licence_number")} expired ${formatDate(expiry)}`,
      job: "verify_entity",
      evidence: [{ documentId: licence.id, field: "expiry_date" }],
    });
  }

  if (application) {
    const signers = names(application, "signatory_names");
    const authorised = [
      ...directorRegisters.flatMap((register) =>
        list<{ name: string }>(register, "directors").map((item) => item.name),
      ),
      ...list<{ name: string }>(resolution, "signatories").map(
        (item) => item.name,
      ),
    ];
    const unauthorised = signers.filter(
      (signer) => !authorised.some((name) => sameName(name, signer)),
    );
    if (signers.length > 0) {
      checks.push({
        id: "signatories_authorised",
        outcome:
          authorised.length === 0
            ? "review"
            : unauthorised.length === 0
              ? "pass"
              : "fail",
        detail:
          authorised.length === 0
            ? `Signed by ${signers.join(" and ")}, but no register or resolution shows who may sign`
            : unauthorised.length === 0
              ? `Signed by ${signers.join(" and ")}, each a director or authorised signatory`
              : `${unauthorised.join(" and ")} signed but ${unauthorised.length === 1 ? "is" : "are"} not a director or authorised signatory`,
        job: "verify_entity",
        evidence: [{ documentId: application.id, field: "signatory_names" }],
      });
    }
  }

  const failed = checks.filter((check) => check.outcome === "fail").length;
  return {
    checks,
    summary: legalName
      ? `${legalName}: ${failed === 0 ? "papers agree" : `${failed} problem${failed === 1 ? "" : "s"}`}`
      : "No company papers to verify",
  };
}

export { sameName };
