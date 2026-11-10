import { formatDate, formatMoney, isoDate } from "../dates";
import { sameName, words } from "../names";
import { RULEBOOK } from "../rulebook";
import {
  type Check,
  documentsOf,
  firstOf,
  flag,
  money,
  names,
  type RunDocument,
  type RunState,
  text,
} from "../run-state";
import { subjectAge } from "./identity";
import type { JobOutcome } from "./types";

const STOP = new Set([
  "unit",
  "apt",
  "road",
  "rd",
  "street",
  "st",
  "close",
  "drive",
  "dr",
  "lane",
  "ln",
  "avenue",
  "ave",
  "way",
  "grand",
  "cayman",
  "islands",
  "ky1",
  "the",
  "of",
]);

/** Share of the distinctive words in `a` that also appear in `b`. */
export function addressOverlap(a: string, b: string) {
  const left = words(a).filter((word) => !STOP.has(word));
  const right = new Set(words(b));
  if (left.length === 0) return 0;
  return left.filter((word) => right.has(word)).length / left.length;
}

const isProperty = (type: string) =>
  (RULEBOOK.propertyPurposes as readonly string[]).includes(type);

function check(
  id: Check["id"],
  outcome: Check["outcome"],
  detail: string,
  evidence: Check["evidence"] = [],
): Check {
  return { id, outcome, detail, job: "check_eligibility", evidence };
}

/** check_eligibility: the National Pensions Act rules for one request. */
export function checkEligibility(state: RunState): JobOutcome {
  const form = firstOf(state, "withdrawal_request_form");
  const statement = firstOf(state, "member_statement");
  if (!form) {
    return { checks: [], summary: "No withdrawal request to check" };
  }
  const checks: Check[] = [];
  const type = text(form, "withdrawal_type");
  const amount = money(form, "amount_requested") ?? 0;
  const member = text(form, "member_name") || text(statement, "member_name");
  const on = (document: RunDocument | undefined, field: string) =>
    document ? [{ documentId: document.id, field }] : [];

  // Purpose
  if (isProperty(type)) {
    checks.push(
      check(
        "withdrawal_purpose_supported",
        "pass",
        type === "property_purchase"
          ? "Purchase or construction of a home"
          : "Reduction of a mortgage on the member's home",
        on(form, "withdrawal_type"),
      ),
    );
  } else if (type === "early_retirement") {
    const age = subjectAge(state);
    checks.push(
      check(
        "withdrawal_purpose_supported",
        age === null
          ? "review"
          : age >= RULEBOOK.earlyRetirementAge
            ? "pass"
            : "fail",
        age === null
          ? "Early retirement, but no date of birth to confirm the age"
          : `Early retirement at ${age}; the Act allows it from ${RULEBOOK.earlyRetirementAge}`,
        on(form, "date_of_birth"),
      ),
    );
  } else {
    checks.push(
      check(
        "withdrawal_purpose_supported",
        "fail",
        `"${type || "unstated"}" is not a purpose the Act allows`,
        on(form, "withdrawal_type"),
      ),
    );
  }

  // Amount
  if (isProperty(type)) {
    checks.push(
      check(
        "amount_within_cap",
        amount <= RULEBOOK.propertyWithdrawalCap ? "pass" : "fail",
        amount <= RULEBOOK.propertyWithdrawalCap
          ? `${formatMoney(amount)} is within the ${formatMoney(RULEBOOK.propertyWithdrawalCap)} cap`
          : `${formatMoney(amount)} requested; the property cap is ${formatMoney(RULEBOOK.propertyWithdrawalCap)}`,
        on(form, "amount_requested"),
      ),
    );
  }
  const balance = money(statement, "total_balance");
  if (balance !== null) {
    checks.push(
      check(
        "amount_within_balance",
        amount <= balance ? "pass" : "fail",
        `${formatMoney(amount)} requested against a balance of ${formatMoney(balance)}${statement ? ` at ${formatDate(text(statement, "statement_date"))}` : ""}`,
        [...on(form, "amount_requested"), ...on(statement, "total_balance")],
      ),
    );
  }

  if (isProperty(type)) {
    // Caymanian status
    const status = documentsOf(state, "caymanian_status_evidence").find(
      (document) => document.fields,
    );
    const declared = flag(form, "caymanian_status_declared");
    if (status && sameName(text(status, "full_name"), member)) {
      checks.push(
        check(
          "caymanian_status",
          "pass",
          `${text(status, "full_name")}: Caymanian by ${text(status, "status_basis") || "status"} (${text(status, "document_number")})`,
          on(status, "full_name"),
        ),
      );
    } else if (status) {
      checks.push(
        check(
          "caymanian_status",
          "review",
          `Status evidence is in the name ${text(status, "full_name")}, not ${member}`,
          on(status, "full_name"),
        ),
      );
    } else {
      checks.push(
        check(
          "caymanian_status",
          declared ? "review" : "fail",
          declared
            ? "Caymanian status ticked on the form, but no evidence is on file"
            : "The member does not declare Caymanian status; property withdrawals are for Caymanians only",
          on(form, "caymanian_status_declared"),
        ),
      );
    }

    // Property evidence
    const evidenceDocuments = [
      ...documentsOf(state, "sale_agreement"),
      ...documentsOf(state, "land_registry_extract"),
      ...documentsOf(state, "mortgage_statement"),
      ...documentsOf(state, "lender_letter"),
    ].filter((document) => document.fields);
    const address = text(form, "property_address");
    if (evidenceDocuments.length > 0) {
      const problems: string[] = [];
      for (const document of evidenceDocuments) {
        const theirs = text(document, "property_address");
        const houseNumber = (value: string) =>
          value.match(/^\s*(?:unit\s+)?(\d+[a-z]?)\b/i)?.[1];
        const numbersDiffer =
          houseNumber(address) &&
          houseNumber(theirs) &&
          houseNumber(address) !== houseNumber(theirs);
        if (
          address &&
          theirs &&
          (numbersDiffer ||
            (addressOverlap(address, theirs) < 0.6 &&
              addressOverlap(theirs, address) < 0.6))
        ) {
          problems.push(
            `the ${document.kind?.replaceAll("_", " ")} is for ${theirs}, the request for ${address}`,
          );
        }
        const people = [
          ...names(document, "purchaser_names"),
          ...names(document, "borrower_names"),
          ...names(document, "registered_proprietors"),
        ];
        if (
          people.length > 0 &&
          !people.some((person) => sameName(person, member))
        ) {
          problems.push(
            `${member} is not among ${people.join(", ")} on the ${document.kind?.replaceAll("_", " ")}`,
          );
        }
      }
      checks.push(
        check(
          "purpose_evidence_consistent",
          problems.length === 0 ? "pass" : "fail",
          problems.length === 0
            ? `${evidenceDocuments.length} document${evidenceDocuments.length === 1 ? "" : "s"} agree on ${address || "the property"} with ${member} as a party`
            : problems.join("; ").replace(/^./, (c) => c.toUpperCase()),
          evidenceDocuments.map((document) => ({
            documentId: document.id,
            field: "property_address",
          })),
        ),
      );
    }

    // Lender
    const lender = documentsOf(state, "lender_letter").find(
      (document) => document.fields,
    );
    if (lender) {
      const kind = text(lender, "lender_type");
      const permitted = (
        RULEBOOK.permittedLenderTypes as readonly string[]
      ).includes(kind);
      checks.push(
        check(
          "lender_permitted",
          permitted ? "pass" : "fail",
          permitted
            ? `${text(lender, "lender_name")} is a ${kind.replaceAll("_", " ")}`
            : `${text(lender, "lender_name")} is a ${kind.replaceAll("_", " ") || "lender of unknown type"}, not a permitted institution`,
          on(lender, "lender_type"),
        ),
      );
    }

    checks.push(
      check(
        "primary_residence",
        flag(form, "primary_residence_declared") ? "pass" : "fail",
        flag(form, "primary_residence_declared")
          ? "Primary residence declared on the form"
          : "The form does not declare the property as the member's primary residence",
        on(form, "primary_residence_declared"),
      ),
    );
  }

  if (statement) {
    const prior = money(statement, "prior_property_withdrawals") ?? 0;
    const repaid = flag(statement, "prior_withdrawals_repaid");
    checks.push(
      check(
        "prior_withdrawals_repaid",
        prior === 0 || repaid ? "pass" : "fail",
        prior === 0
          ? "No earlier property withdrawals"
          : repaid
            ? `Earlier withdrawals of ${formatMoney(prior)} are being repaid`
            : `Earlier withdrawals of ${formatMoney(prior)} are not being repaid`,
        on(statement, "prior_property_withdrawals"),
      ),
    );
  }

  const failed = checks.filter((item) => item.outcome === "fail");
  return {
    checks,
    summary:
      failed.length === 0
        ? `${checks.length} rules checked, none broken`
        : `${failed.length} of ${checks.length} rules broken: ${failed.map((item) => item.id.replaceAll("_", " ")).join(", ")}`,
  };
}

const ORG_WORDS = new Set([
  "client",
  "account",
  "attorneys",
  "attorney",
  "legal",
  "law",
  "chambers",
  "bank",
  "credit",
  "union",
  "society",
  "ltd",
  "limited",
  "trust",
  "escrow",
  "partners",
  "llp",
  "co",
  "company",
]);

const looksLikeOrganisation = (name: string) =>
  words(name).some((word) => ORG_WORDS.has(word));

const digits = (value: string) => value.replace(/\D/g, "");

/** verify_payee: the money goes to the lender, the attorney's client account or the member. */
export function verifyPayee(state: RunState): JobOutcome {
  const form = firstOf(state, "withdrawal_request_form");
  if (!form) return { checks: [], summary: "No payment instruction to verify" };
  const payee = text(form, "payee_name");
  const account = digits(text(form, "payee_account_number"));
  const member = text(form, "member_name");
  const property = isProperty(text(form, "withdrawal_type"));
  const evidence = [{ documentId: form.id, field: "payee_name" }];
  const verdict = (outcome: Check["outcome"], detail: string): JobOutcome => ({
    checks: [
      { id: "payee_permitted", outcome, detail, job: "verify_payee", evidence },
    ],
    summary: detail,
  });

  if (!payee) return verdict("review", "No payee on the request");

  // The words that identify an account holder, without "client", "account", "ltd" and the like.
  const core = (name: string) =>
    words(name).filter((word) => !ORG_WORDS.has(word));
  const covers = (candidate: string) => {
    const wanted = core(payee);
    const have = new Set(words(candidate));
    return wanted.length > 0 && wanted.every((word) => have.has(word));
  };

  for (const letter of documentsOf(state, "attorney_letter")) {
    const name = text(letter, "client_account_name");
    const number = digits(text(letter, "client_account_number"));
    if (
      covers(`${name} ${text(letter, "firm_name")}`) ||
      (account && number && account === number)
    ) {
      evidence.push({ documentId: letter.id, field: "client_account_name" });
      if (account && number && account !== number) {
        return verdict(
          "fail",
          `Account ${text(form, "payee_account_number")} on the form differs from the client account ${text(letter, "client_account_number")} in ${text(letter, "firm_name")}'s letter`,
        );
      }
      return verdict(
        property ? "pass" : "review",
        `${payee} is ${text(letter, "firm_name")}'s client account, confirmed in their letter`,
      );
    }
  }
  const lenders = [
    ...documentsOf(state, "lender_letter").map((document) => ({
      document,
      field: "lender_name",
    })),
    ...documentsOf(state, "mortgage_statement").map((document) => ({
      document,
      field: "lender_name",
    })),
    ...documentsOf(state, "land_registry_extract").map((document) => ({
      document,
      field: "charge_holder",
    })),
  ];
  for (const { document, field } of lenders) {
    const name = text(document, field);
    if (name && covers(name)) {
      evidence.push({ documentId: document.id, field });
      return verdict(
        property ? "pass" : "review",
        `Paid straight to the lender, ${name}`,
      );
    }
  }
  for (const letter of documentsOf(state, "bank_letter")) {
    const holder = text(letter, "account_holder");
    if (holder && sameName(holder, payee, 85)) {
      evidence.push({ documentId: letter.id, field: "account_holder" });
      if (sameName(holder, member)) {
        return verdict(
          property ? "review" : "pass",
          property
            ? `${holder}'s own account: property withdrawals go to the lender or attorney`
            : `${holder}'s own account at ${text(letter, "bank_name")}, confirmed by the bank`,
        );
      }
      return verdict(
        "fail",
        `${holder} is a third party; the bank confirms the account is theirs, not the member's`,
      );
    }
  }
  if (sameName(payee, member)) {
    return verdict(
      property ? "review" : "pass",
      property
        ? `Paid to ${member}'s own account: property withdrawals go to the lender or attorney`
        : `Paid to ${member}'s own account`,
    );
  }
  if (property && /client/i.test(payee) && looksLikeOrganisation(payee)) {
    return verdict(
      "pass",
      `${payee} is an attorney's client account; no confirmation letter is on file`,
    );
  }
  if (!looksLikeOrganisation(payee)) {
    return verdict(
      "fail",
      `${payee} is neither the member, the lender nor an attorney's client account`,
    );
  }
  return verdict(
    "review",
    `${payee} could not be matched to a lender or attorney letter on file`,
  );
}

export { isoDate };
