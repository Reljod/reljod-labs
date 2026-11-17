import { DOCUMENT_OPTIONS } from "../pipelines/documents";
import { MEMBER_REQUEST_KINDS, MEMBER_REQUEST_LABEL } from "../records";
import type { RuleSpec } from "../rules";

/*
 * Every Rule a Pipeline checks (ADR 0015): the sentence, its Parameters with
 * their ranges, the default values, the Outcome, the citation and the date
 * the Default took effect. The checks themselves are pure functions in
 * `domain/pipelines/checks/`, one per Rule id.
 *
 * Defaults come only from entries of `fixtures/harness/RULES-REFERENCE.md`
 * marked verified. Where the reference found no source (an arithmetic
 * tolerance, a list of papers, the prime rate), the citation says
 * "illustrative, plan practice". Effective dates are the reference's: 31 Dec
 * 2017 (overseas transfers), 31 Dec 2019 (cash refunds end), 1 Jan 2017
 * (YMPE, normal age 65), 1 Jul 2023 (delinquency provisions), 9 Dec 2023
 * (property withdrawals), 31 Jul 2011 (General Regulations, 2011 Revision)
 * and, where the reference gives none, 8 Feb 2024 (the 2024 Revision of the
 * Act gazetted).
 */

const ACT = "National Pensions Act (2024 Revision)";
const REGS = "National Pensions (General) Regulations (2011 Revision)";
const OVERSEAS_NOTE = "DLP Guidance Note: International Transfers (rev. 2021)";
const PRACTICE = "illustrative, plan practice";
const REVISION_2024 = "2024-02-08";

const KIND_OPTIONS = MEMBER_REQUEST_KINDS.map((kind) => ({
  value: kind,
  label: MEMBER_REQUEST_LABEL[kind],
}));

const MEMBER_REQUEST_RULES: RuleSpec[] = [
  {
    id: "mr.identity-match",
    pipelineId: "member_request",
    stepId: "check_identity",
    title: "Request matches the Member record",
    sentence:
      "The member number, name and date of birth on the papers must match the Member record, allowing up to {maxNameDistance} in the name.",
    params: {
      maxNameDistance: {
        kind: "number",
        label: "Letters that may differ",
        min: 0,
        max: 5,
        step: 1,
        unit: "differing letters",
      },
    },
    defaults: { maxNameDistance: 2 },
    defaultOutcome: "refer",
    citation: `Plan administration: identifying the Member (${PRACTICE})`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "mr.account-open",
    pipelineId: "member_request",
    stepId: "check_identity",
    title: "Account is open",
    sentence:
      "A request cannot proceed on an account whose status is {blockedStatuses}.",
    params: {
      blockedStatuses: {
        kind: "list",
        label: "Statuses that stop a request",
        options: [
          { value: "closed", label: "closed" },
          { value: "retired", label: "retired" },
          { value: "deceased", label: "deceased" },
        ],
        minItems: 0,
        maxItems: 3,
      },
    },
    defaults: { blockedStatuses: ["closed"] },
    defaultOutcome: "block",
    citation: `Plan administration: account status (${PRACTICE})`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "mr.employment-ended",
    pipelineId: "member_request",
    stepId: "check_eligibility",
    title: "Employment has ended",
    sentence:
      "A request of kind {kinds} needs the Member's employment to have ended.",
    params: {
      kinds: {
        kind: "list",
        label: "Request kinds",
        options: KIND_OPTIONS,
        minItems: 0,
        maxItems: KIND_OPTIONS.length,
      },
    },
    defaults: { kinds: ["transfer_out", "cessation_of_residence"] },
    defaultOutcome: "block",
    citation: `${ACT} s.34(1), s.34(3)`,
    effectiveFrom: "2017-12-31",
  },
  {
    id: "mr.overseas-absence",
    pipelineId: "member_request",
    stepId: "check_eligibility",
    title: "Away from the Islands long enough",
    sentence:
      "A transfer to a plan outside the Islands needs the Member to have been absent from the Islands for at least {minYears}.",
    params: {
      minYears: { kind: "years", label: "Years absent", min: 1, max: 10 },
    },
    defaults: { minYears: 2 },
    defaultOutcome: "block",
    citation: `${ACT} s.34(5); ${OVERSEAS_NOTE}`,
    effectiveFrom: "2017-12-31",
  },
  {
    id: "mr.overseas-no-contributions",
    pipelineId: "member_request",
    stepId: "check_eligibility",
    title: "No recent contributions",
    sentence:
      "A transfer to a plan outside the Islands needs no contributions by or for the Member for at least {minYears}.",
    params: {
      minYears: {
        kind: "years",
        label: "Years without contributions",
        min: 1,
        max: 10,
      },
    },
    defaults: { minYears: 2 },
    defaultOutcome: "block",
    citation: `${ACT} s.34(3); ${OVERSEAS_NOTE}`,
    effectiveFrom: "2017-12-31",
  },
  {
    id: "mr.cash-refund-closed",
    pipelineId: "member_request",
    stepId: "check_eligibility",
    title: "No cash refund on leaving",
    sentence:
      "A Member leaving the Islands with a balance of {threshold} or more cannot take a cash refund; only a transfer or staying in the plan is open.",
    params: {
      threshold: {
        kind: "money",
        label: "Small-balance limit",
        min: 0,
        max: 100_000,
      },
    },
    defaults: { threshold: 5_000 },
    defaultOutcome: "warn",
    citation: `${ACT} s.42, s.53(7); DLP brochure on the 2016 amendments (refunds ended 31 Dec 2019)`,
    effectiveFrom: "2019-12-31",
  },
  {
    id: "mr.property-caymanian",
    pipelineId: "member_request",
    stepId: "check_eligibility",
    title: "Caymanian only",
    sentence: "Only a Caymanian may withdraw pension money for property.",
    params: {},
    defaults: {},
    defaultOutcome: "block",
    citation: `${ACT} s.52B(1), s.52BA(1), s.52C(1)`,
    effectiveFrom: "2023-12-09",
  },
  {
    id: "mr.property-cap",
    pipelineId: "member_request",
    stepId: "check_eligibility",
    title: "Property withdrawal within the cap",
    sentence:
      "A deposit or mortgage reduction may be at most {depositCap} and paying off a mortgage at most {payoffCap}, and never more than the Member's balance.",
    params: {
      depositCap: {
        kind: "money",
        label: "Deposit or reduction cap",
        min: 0,
        max: 1_000_000,
      },
      payoffCap: {
        kind: "money",
        label: "Pay-off cap",
        min: 0,
        max: 1_000_000,
      },
    },
    defaults: { depositCap: 50_000, payoffCap: 100_000 },
    defaultOutcome: "block",
    citation: `${ACT} s.52B(1), s.52C(1), s.52E`,
    effectiveFrom: "2023-12-09",
  },
  {
    id: "mr.retirement-age",
    pipelineId: "member_request",
    stepId: "check_eligibility",
    title: "Old enough to retire",
    sentence:
      "Retirement needs the Member to be {normalAge} old, or {earlyAge} old with their employment ended.",
    params: {
      normalAge: { kind: "years", label: "Normal age", min: 50, max: 75 },
      earlyAge: { kind: "years", label: "Early age", min: 40, max: 75 },
    },
    defaults: { normalAge: 65, earlyAge: 55 },
    defaultOutcome: "block",
    citation: `${ACT} s.3 (normal age of pension entitlement), s.33`,
    effectiveFrom: "2017-01-01",
  },
  {
    id: "mr.transfer-time-limit",
    pipelineId: "member_request",
    stepId: "check_deadline",
    title: "Transfer done in time",
    sentence:
      "A transfer must be carried out within {days} of the direction being delivered.",
    params: { days: { kind: "days", label: "Days", min: 1, max: 365 } },
    defaults: { days: 45 },
    defaultOutcome: "refer",
    citation: `${ACT} s.34(8)`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "mr.property-time-limit",
    pipelineId: "member_request",
    stepId: "check_deadline",
    title: "Property withdrawal paid or refused in time",
    sentence:
      "A property withdrawal must be paid within {payDays} of the application, or refused within {refuseDays} with written reasons.",
    params: {
      payDays: { kind: "days", label: "Days to pay", min: 1, max: 365 },
      refuseDays: { kind: "days", label: "Days to refuse", min: 1, max: 90 },
    },
    defaults: { payDays: 60, refuseDays: 7 },
    defaultOutcome: "refer",
    citation: `${ACT} s.52B(6), s.52BA(8), s.52C(5)`,
    effectiveFrom: "2023-12-09",
  },
  {
    id: "mr.statement-time-limit",
    pipelineId: "member_request",
    stepId: "check_deadline",
    title: "Statement sent in time",
    sentence:
      "Give a retirement statement within {retirementDays} of the application, and a statement of benefits within {deathDays} of notice of a Member's death.",
    params: {
      retirementDays: {
        kind: "days",
        label: "Days for a retirement statement",
        min: 1,
        max: 180,
      },
      deathDays: {
        kind: "days",
        label: "Days for a death statement",
        min: 1,
        max: 180,
      },
    },
    defaults: { retirementDays: 30, deathDays: 30 },
    defaultOutcome: "refer",
    citation: `${REGS} reg.23(1), reg.27(4)`,
    effectiveFrom: "2011-07-31",
  },
  {
    id: "mr.docs-statutory",
    pipelineId: "member_request",
    stepId: "check_documents",
    title: "Papers the law asks for",
    sentence:
      "A transfer to another plan needs {transferOut}; a transfer outside the Islands needs {overseas}; a property withdrawal needs {property}, plus {propertyDeposit} for a deposit, or {propertyMortgage} to reduce or pay off a mortgage.",
    params: {
      transferOut: {
        kind: "list",
        label: "Transfer to another plan",
        options: DOCUMENT_OPTIONS,
        minItems: 0,
        maxItems: 8,
      },
      overseas: {
        kind: "list",
        label: "Transfer outside the Islands",
        options: DOCUMENT_OPTIONS,
        minItems: 0,
        maxItems: 8,
      },
      property: {
        kind: "list",
        label: "Property withdrawal",
        options: DOCUMENT_OPTIONS,
        minItems: 0,
        maxItems: 8,
      },
      propertyDeposit: {
        kind: "list",
        label: "Property: deposit",
        options: DOCUMENT_OPTIONS,
        minItems: 0,
        maxItems: 8,
      },
      propertyMortgage: {
        kind: "list",
        label: "Property: reduce or pay off",
        options: DOCUMENT_OPTIONS,
        minItems: 0,
        maxItems: 8,
      },
    },
    defaults: {
      transferOut: ["transfer_form"],
      overseas: [
        "transfer_form",
        "international_questionnaire",
        "receiving_plan_document",
        "photo_id",
      ],
      property: ["property_form", "caymanian_status", "lender_letter"],
      propertyDeposit: ["non_home_owner_declaration"],
      propertyMortgage: ["land_register"],
    },
    defaultOutcome: "refer",
    citation: `${ACT} s.52B(3), s.52BA(2), s.52C(2); ${OVERSEAS_NOTE}; DLP Individual Transfer Request form`,
    effectiveFrom: "2023-12-09",
  },
  {
    id: "mr.docs-plan",
    pipelineId: "member_request",
    stepId: "check_documents",
    title: "Papers the plan asks for",
    sentence:
      "A retirement needs {retirement}; a claim on death needs {death}.",
    params: {
      retirement: {
        kind: "list",
        label: "Retirement",
        options: DOCUMENT_OPTIONS,
        minItems: 0,
        maxItems: 8,
      },
      death: {
        kind: "list",
        label: "Claim on death",
        options: DOCUMENT_OPTIONS,
        minItems: 0,
        maxItems: 8,
      },
    },
    defaults: {
      retirement: ["retirement_application", "photo_id"],
      death: ["death_certificate", "claimant_id", "proof_of_relationship"],
    },
    defaultOutcome: "refer",
    citation: `Plan administration (${PRACTICE}): no Cayman source read lists these papers`,
    effectiveFrom: REVISION_2024,
  },
];

const CONTRIBUTION_RULES: RuleSpec[] = [
  {
    id: "cp.known-member",
    pipelineId: "contribution_processing",
    stepId: "match_members",
    title: "Every line is a Member",
    sentence: "Every line of a Schedule must name a Member of the plan.",
    params: {},
    defaults: {},
    defaultOutcome: "refer",
    citation: `Plan administration: matching lines to accounts (${PRACTICE})`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.no-terminated",
    pipelineId: "contribution_processing",
    stepId: "match_members",
    title: "No lines for leavers",
    sentence:
      "No line may be for a Member whose employment ended before the month, or whose account is closed.",
    params: {},
    defaults: {},
    defaultOutcome: "refer",
    citation: `Plan administration: matching lines to accounts (${PRACTICE})`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.no-duplicates",
    pipelineId: "contribution_processing",
    stepId: "match_members",
    title: "One line per Member",
    sentence: "A Member appears once in a Schedule.",
    params: {},
    defaults: {},
    defaultOutcome: "refer",
    citation: `Plan administration: matching lines to accounts (${PRACTICE})`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.employer-rate",
    pipelineId: "contribution_processing",
    stepId: "check_rates",
    title: "Employer pays its share",
    sentence:
      "The Employer pays at least {minRate} of each Member's pensionable earnings.",
    params: {
      minRate: {
        kind: "percent",
        label: "Employer rate",
        min: 0,
        max: 20,
        step: 0.5,
      },
    },
    defaults: { minRate: 5 },
    defaultOutcome: "refer",
    citation: `${ACT} s.47(3)(b)`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.employee-rate",
    pipelineId: "contribution_processing",
    stepId: "check_rates",
    title: "Employee deduction within the limit",
    sentence:
      "The deduction from a Member's pay is at most {maxRate} of pensionable earnings.",
    params: {
      maxRate: {
        kind: "percent",
        label: "Employee rate",
        min: 0,
        max: 20,
        step: 0.5,
      },
    },
    defaults: { maxRate: 5 },
    defaultOutcome: "refer",
    citation: `${ACT} s.47(3)(a)`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.total-rate",
    pipelineId: "contribution_processing",
    stepId: "check_rates",
    title: "Total contribution",
    sentence:
      "Employer and Member together pay {totalRate} of pensionable earnings, to within {tolerance} a line.",
    params: {
      totalRate: {
        kind: "percent",
        label: "Total rate",
        min: 0,
        max: 40,
        step: 0.5,
      },
      tolerance: {
        kind: "money",
        label: "Rounding allowed",
        min: 0,
        max: 10,
        step: 0.01,
      },
    },
    defaults: { totalRate: 10, tolerance: 0.01 },
    defaultOutcome: "refer",
    citation: `${ACT} s.47(3)(c); the rounding allowance is ${PRACTICE}`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.ympe-cap",
    pipelineId: "contribution_processing",
    stepId: "check_cap",
    title: "Earnings cap",
    sentence:
      "Mandatory contributions are due only on earnings up to {annualCap} a year (one twelfth of it a month); more is a voluntary contribution.",
    params: {
      annualCap: {
        kind: "money",
        label: "Year's maximum pensionable earnings",
        min: 0,
        max: 500_000,
      },
    },
    defaults: { annualCap: 87_000 },
    defaultOutcome: "warn",
    citation: `${ACT} s.3 (year's maximum pensionable earnings); counting one twelfth a month is ${PRACTICE}`,
    effectiveFrom: "2017-01-01",
  },
  {
    id: "cp.coverage-age",
    pipelineId: "contribution_processing",
    stepId: "check_coverage",
    title: "Age range covered",
    sentence:
      "Contributions are mandatory for employees aged {minAge} up to {maxAge}; outside that range they are voluntary.",
    params: {
      minAge: { kind: "years", label: "From age", min: 14, max: 30 },
      maxAge: { kind: "years", label: "Up to age", min: 50, max: 75 },
    },
    defaults: { minAge: 18, maxAge: 65 },
    defaultOutcome: "warn",
    citation: `${ACT} s.4(1), s.25(1)`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.nine-month",
    pipelineId: "contribution_processing",
    stepId: "check_coverage",
    title: "Waiting period for non-Caymanians",
    sentence:
      "An employee who is neither Caymanian nor a permanent resident need not be covered until they have worked in the Islands for more than {months}.",
    params: { months: { kind: "months", label: "Months", min: 0, max: 24 } },
    defaults: { months: 9 },
    defaultOutcome: "warn",
    citation: `${ACT} s.25(2)(a)`,
    effectiveFrom: REVISION_2024,
  },
  {
    id: "cp.remittance-total",
    pipelineId: "contribution_processing",
    stepId: "match_remittance",
    title: "Money matches the Schedule",
    sentence:
      "The money received for the month must equal the Schedule's total, to within {tolerance}.",
    params: {
      tolerance: {
        kind: "money",
        label: "Difference allowed",
        min: 0,
        max: 100,
        step: 0.01,
      },
    },
    defaults: { tolerance: 0.01 },
    defaultOutcome: "refer",
    citation: `${ACT} s.48(2); the difference allowed is ${PRACTICE}`,
    effectiveFrom: "2023-07-01",
  },
  {
    id: "cp.remittance-on-time",
    pipelineId: "contribution_processing",
    stepId: "match_remittance",
    title: "Money arrived on time",
    sentence:
      "The money for a month must arrive by day {dueDay} of the following month.",
    params: {
      dueDay: {
        kind: "number",
        label: "Day of the month",
        min: 1,
        max: 28,
        step: 1,
      },
    },
    defaults: { dueDay: 15 },
    defaultOutcome: "warn",
    citation: `${ACT} s.48(2)-(3)`,
    effectiveFrom: "2023-07-01",
  },
];

const DELINQUENCY_RULES: RuleSpec[] = [
  {
    id: "dr.missing",
    pipelineId: "delinquency_report",
    stepId: "find_missing",
    title: "Every Employer remitted",
    sentence:
      "Every active Employer must remit for the month by day {dueDay} of the following month; money not received by then is delinquent.",
    params: {
      dueDay: {
        kind: "number",
        label: "Day of the month",
        min: 1,
        max: 28,
        step: 1,
      },
    },
    defaults: { dueDay: 15 },
    defaultOutcome: "refer",
    citation: `${ACT} s.48(2)-(4)`,
    effectiveFrom: "2023-07-01",
  },
  {
    id: "dr.short",
    pipelineId: "delinquency_report",
    stepId: "find_missing",
    title: "Remitted in full",
    sentence:
      "Money short of the Employer's Schedule by more than {tolerance} leaves the rest delinquent.",
    params: {
      tolerance: {
        kind: "money",
        label: "Difference allowed",
        min: 0,
        max: 100,
        step: 0.01,
      },
    },
    defaults: { tolerance: 0.01 },
    defaultOutcome: "refer",
    citation: `${ACT} s.48(3); the difference allowed is ${PRACTICE}`,
    effectiveFrom: "2023-07-01",
  },
  {
    id: "dr.late",
    pipelineId: "delinquency_report",
    stepId: "find_late",
    title: "Remitted on time",
    sentence:
      "Money received after day {dueDay} of the following month was late, and owes interest from the day after.",
    params: {
      dueDay: {
        kind: "number",
        label: "Day of the month",
        min: 1,
        max: 28,
        step: 1,
      },
    },
    defaults: { dueDay: 15 },
    defaultOutcome: "warn",
    citation: `${ACT} s.48(3), s.50(1)`,
    effectiveFrom: "2023-07-01",
  },
  {
    id: "dr.interest",
    pipelineId: "delinquency_report",
    stepId: "compute",
    title: "Interest on late money",
    sentence:
      "Late or unpaid contributions carry interest at the prime rate ({primeRate}) plus {margin} a year, counted daily from the day after the due date.",
    params: {
      primeRate: {
        kind: "percent",
        label: "Prime rate",
        min: 0,
        max: 30,
        step: 0.25,
      },
      margin: {
        kind: "percent",
        label: "Margin over prime",
        min: 0,
        max: 20,
        step: 0.25,
      },
    },
    defaults: { primeRate: 8.5, margin: 5 },
    defaultOutcome: "warn",
    citation: `${ACT} s.50(1)-(3); the prime rate value is ${PRACTICE} (not sourced)`,
    effectiveFrom: "2023-07-01",
  },
  {
    id: "dr.report-deadline",
    pipelineId: "delinquency_report",
    stepId: "compute",
    title: "Director told in time",
    sentence:
      "Money still unpaid on day {reportableDay} of the second month after the month is reported to the Director by day {reportDay} of that month.",
    params: {
      reportableDay: {
        kind: "number",
        label: "Reportable on day",
        min: 1,
        max: 28,
        step: 1,
      },
      reportDay: {
        kind: "number",
        label: "Report by day",
        min: 1,
        max: 28,
        step: 1,
      },
    },
    defaults: { reportableDay: 15, reportDay: 20 },
    defaultOutcome: "refer",
    citation: `${ACT} s.48(5)-(6)(a)`,
    effectiveFrom: "2023-07-01",
  },
];

export const RULE_SPECS: RuleSpec[] = [
  ...MEMBER_REQUEST_RULES,
  ...CONTRIBUTION_RULES,
  ...DELINQUENCY_RULES,
];

export function ruleSpecOf(ruleId: string): RuleSpec | null {
  return RULE_SPECS.find((spec) => spec.id === ruleId) ?? null;
}
