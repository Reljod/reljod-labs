import type { ApprovalRisk } from "../permissions";
import {
  MEMBER_REQUEST_LABEL,
  type Member,
  type MemberRequestKind,
} from "../records";
import type { Draft } from "../run";
import { formatDate, formatKyd, formatPeriod } from "./dates";
import type { DecideResult } from "./decide";
import type { ArrearsRow } from "./delinquency-report";
import type { Reconciliation } from "./reconcile";

/*
 * Everything about a Draft that code decides: its kind, who it goes to, the
 * risk of approving it, the particulars block with every amount, and a plain
 * template body. A model Step may write a better body; the particulars are
 * always appended as code wrote them, so no amount comes from a model.
 */

export const BANK = "Harbour Bank & Trust";
export const DESK = "Pensions Operations Desk";
export const DIRECTOR = "The Director of Labour and Pensions";

/** The plan of a Draft before its body is written. */
export type DraftPlan = {
  kind: string;
  title: string;
  to: string | null;
  risk: ApprovalRisk;
  /** Markdown with the amounts and dates, from code. */
  particulars: string;
  /** The body the template writes when no model does. */
  fallbackBody: string;
  /** What the model is told the letter must say, one line each. */
  points: string[];
};

/** The Draft a person sees: the body, then the particulars as code wrote them. */
export function finishDraft(
  plan: DraftPlan,
  body: string,
  stepId: string,
): Draft {
  const text = body.trim() || plan.fallbackBody;
  return {
    kind: plan.kind,
    title: plan.title,
    to: plan.to,
    body: plan.particulars ? `${text}\n\n${plan.particulars}` : text,
    stepId,
  };
}

const table = (rows: [string, string][]) =>
  [
    "| | |",
    "|---|---|",
    ...rows.map(([key, value]) => `| ${key} | ${value} |`),
  ].join("\n");

const sign = `${DESK}\n${BANK}`;

// Member request ---------------------------------------------------------------------------

export type MemberRequestDraftInput = {
  decide: DecideResult;
  kind: MemberRequestKind | null;
  member: Member | null;
  /** The name on the papers, when there is no record. */
  claimedName: string | null;
  requestedAmountKyd: number | null;
  receivingPlan: string | null;
  /** Rule ids of papers that are missing, with their labels. */
  missingPapers: string[];
  note: string | null;
  asOf: string;
  receivedOn: string;
};

/** The amount a proceeding request moves, worked out in code. */
export function memberRequestAmount(
  input: Pick<
    MemberRequestDraftInput,
    "member" | "kind" | "requestedAmountKyd"
  >,
): number | null {
  if (!input.member) return null;
  if (input.kind === "property") return input.requestedAmountKyd;
  return input.member.balanceKyd;
}

export function memberRequestDraftPlan(
  input: MemberRequestDraftInput,
): DraftPlan {
  const member = input.member;
  const name = member?.fullName ?? input.claimedName ?? "the Member";
  const label = input.kind
    ? MEMBER_REQUEST_LABEL[input.kind]
    : "Member request";
  const reference = member ? `${label} · ${member.memberNo}` : label;
  const base: [string, string][] = [
    ["Member", member ? `${member.fullName} (${member.memberNo})` : name],
    ["Request", label],
    ["Received", formatDate(input.receivedOn)],
  ];
  const salutation = `Dear ${name},`;

  if (input.decide.decision === "reject") {
    const reasons = input.decide.reasons;
    return {
      kind: "rejection_letter",
      title: `Rejection: ${reference}`,
      to: name,
      risk: "high",
      particulars: `**Particulars**\n\n${table([...base, ["Decision", "Cannot proceed"]])}\n\n**Reasons (from the Rules applied)**\n\n${reasons.map((reason) => `- ${reason}`).join("\n")}`,
      fallbackBody: `${salutation}\n\nThank you for your ${label.toLowerCase()} request, received on ${formatDate(input.receivedOn)}. We have checked it against the National Pensions Act and the plan's rules, and we are not able to proceed with it as made. The reasons are set out below.\n\nIf your circumstances change, or you believe a detail on our record is wrong, please write to us and we will look at the request again.\n\nYours sincerely,\n${sign}`,
      points: [
        "Say plainly the request cannot proceed as made.",
        "Explain each reason in the particulars in plain words; do not add reasons of your own.",
        "Say what the Member can do next (wait until eligible, correct the record, stay in the plan).",
      ],
    };
  }

  if (input.decide.decision === "request_documents") {
    const needs = [
      ...input.missingPapers.map((paper) => `- ${paper}`),
      ...input.decide.reasons
        .filter((reason) => !reason.startsWith("Missing:"))
        .map((reason) => `- To check: ${reason}`),
    ];
    return {
      kind: "documents_letter",
      title: `Papers needed: ${reference}`,
      to: name,
      risk: "low",
      particulars: `**Particulars**\n\n${table(base)}\n\n**What we need**\n\n${needs.join("\n") || "- A short note confirming what you are asking for."}`,
      fallbackBody: `${salutation}\n\nThank you for your request, received on ${formatDate(input.receivedOn)}. Before we can go on with it we need the papers or answers listed below. The time limits for your request run once we have everything.\n\nPlease send them to the ${DESK}, quoting your member number.\n\nYours sincerely,\n${sign}`,
      points: [
        "Ask for exactly the papers and answers listed; nothing more.",
        "Be brief and friendly.",
      ],
    };
  }

  const amount = memberRequestAmount(input);
  const amountText = amount === null ? "to be confirmed" : formatKyd(amount);
  if (
    input.kind === "transfer_out" ||
    input.kind === "cessation_of_residence"
  ) {
    return {
      kind: "transfer_instruction",
      title: `Transfer instruction: ${reference}`,
      to: input.receivingPlan ?? "Receiving plan administrator",
      risk: "high",
      particulars: `**Particulars**\n\n${table([
        ...base,
        ["Amount to transfer", amountText],
        [
          "Receiving plan",
          input.receivingPlan ?? "as named on the transfer form",
        ],
        ...(input.kind === "cessation_of_residence"
          ? ([["Regulator", "Application packet to the DLP for approval"]] as [
              string,
              string,
            ][])
          : []),
      ])}`,
      fallbackBody: `Instruction to transfer the full balance of ${name}'s account to ${input.receivingPlan ?? "the receiving plan named on the transfer form"}, as directed by the Member. Every Rule the Run applied was met. Transfer the amount below once approved and send the Member a confirmation.`,
      points: [
        "Write a short internal instruction to the payments team.",
        "Name the receiving plan and say every Rule was met; the amount is in the particulars.",
      ],
    };
  }
  return {
    kind: "payment_instruction",
    title: `Payment instruction: ${reference}`,
    to:
      input.kind === "property"
        ? "The lender named on the approval-in-principle letter"
        : name,
    risk: "high",
    particulars: `**Particulars**\n\n${table([
      ...base,
      ["Amount", amountText],
      [
        "Pay to",
        input.kind === "property"
          ? "The financial institution, never the Member (s.52B)"
          : input.kind === "retirement"
            ? "A Retirement Savings Arrangement or an approved annuity"
            : "The spouse, beneficiary or estate, as established",
      ],
    ])}`,
    fallbackBody: `Instruction to pay ${amountText} for ${name}'s ${label.toLowerCase()}. Every Rule the Run applied was met. Pay as set out below once approved.`,
    points: [
      "Write a short internal instruction to the payments team.",
      "Say who is paid; the amount is in the particulars.",
    ],
  };
}

// Contribution processing ---------------------------------------------------------------------

export function contributionDraftPlan(input: {
  employer: { code: string; name: string; contactEmail: string | null } | null;
  employerCode: string | null;
  period: string;
  reconciliation: Reconciliation;
  override: boolean;
}): DraftPlan {
  const { reconciliation: recon } = input;
  const employerName =
    input.employer?.name ?? input.employerCode ?? "the Employer";
  const month = formatPeriod(input.period);
  const totals = table([
    [
      "Employer",
      input.employer
        ? `${input.employer.name} (${input.employer.code})`
        : employerName,
    ],
    ["Month", month],
    ["Lines", String(recon.totals.lines)],
    ["Employee contributions", formatKyd(recon.totals.employeeKyd)],
    ["Employer contributions", formatKyd(recon.totals.employerKyd)],
    ["Voluntary", formatKyd(recon.totals.voluntaryKyd)],
    ["Schedule total", formatKyd(recon.totals.totalKyd)],
    ["Money received", formatKyd(recon.totals.receivedKyd)],
    ["Difference", formatKyd(recon.totals.differenceKyd)],
  ]);
  const rows = [...recon.exceptions, ...recon.warnings];
  const exceptions =
    rows.length === 0
      ? ""
      : [
          "",
          "**Exceptions**",
          "",
          "| Line | Member | Rule | What we found |",
          "|---|---|---|---|",
          ...rows.map(
            (row) =>
              `| ${row.line ?? "–"} | ${row.memberNo ?? "–"}${row.memberName ? ` ${row.memberName}` : ""} | ${row.ruleId}${row.outcome === "warn" ? " (note)" : ""} | ${row.detail.replace(/\|/g, "/")} |`,
          ),
          ...recon.readProblems.map(
            (problem) => `| – | – | reading | ${problem} |`,
          ),
        ].join("\n");
  const particulars = `**Particulars**\n\n${totals}${exceptions}`;
  const greeting = `Dear ${employerName} payroll team,`;

  if (recon.decision === "hold" && !input.override) {
    return {
      kind: "employer_query",
      title: `Query: ${employerName} · ${month}`,
      to: input.employer?.contactEmail ?? employerName,
      risk: "low",
      particulars,
      fallbackBody: `${greeting}\n\nWe have checked your contribution Schedule for ${month} and are holding it until the exceptions below are resolved. Please correct the lines listed, send a revised Schedule and pay any shortfall. Contributions are due by the 15th of the following month; late money owes interest from the day after.\n\nKind regards,\n${sign}`,
      points: [
        "Ask the Employer to fix each exception listed; explain each in one line.",
        "Mention that late contributions owe interest.",
      ],
    };
  }
  if (recon.decision === "hold") {
    return {
      kind: "posting_instruction",
      title: `Post over exceptions: ${employerName} · ${month}`,
      to: null,
      risk: "high",
      particulars,
      fallbackBody: `Instruction to post ${employerName}'s Schedule for ${month} to Member accounts although it has the exceptions below. A person chose to override them; record why in the Approval note.`,
      points: [
        "Write a short internal note that the Schedule is posted over its exceptions.",
      ],
    };
  }
  return {
    kind: "posting_note",
    title: `Posted: ${employerName} · ${month}`,
    to: input.employer?.contactEmail ?? employerName,
    risk: "low",
    particulars,
    fallbackBody: `${greeting}\n\nThank you. Your contribution Schedule for ${month} matches the money received and has been posted to your employees' accounts.${recon.warnings.length > 0 ? " A few lines carry notes, listed below; no action is needed unless they are wrong." : ""}\n\nKind regards,\n${sign}`,
    points: ["Confirm the Schedule is posted; mention any notes briefly."],
  };
}

// Delinquency report ------------------------------------------------------------------------------

function arrearsTable(rows: ArrearsRow[]): string {
  if (rows.length === 0) return "No Employer is delinquent for the month.";
  return [
    "| Employer | Problem | Amount | Due | Days late | Rate | Interest |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.name} (${row.code}) | ${row.kind === "late" ? `paid late on ${formatDate(row.paidOn as string)}` : row.kind === "short" ? "paid short" : "not paid"} | ${row.amountKyd === null ? "no Schedule" : formatKyd(row.amountKyd)} | ${formatDate(row.dueOn)} | ${row.daysLate} | ${row.ratePct}% | ${row.interestKyd === null ? "–" : formatKyd(row.interestKyd)} |`,
    ),
  ].join("\n");
}

export function regulatorReportPlan(input: {
  period: string;
  rows: ArrearsRow[];
  reportBy: string;
  asOf: string;
}): DraftPlan {
  const month = formatPeriod(input.period);
  const reportable = input.rows.filter((row) => row.reportable);
  return {
    kind: "regulator_report",
    title: `Delinquent contributions: ${month}`,
    to: DIRECTOR,
    risk: "high",
    particulars: `**Particulars (worked out in code; interest = amount × rate × days ÷ 365)**\n\n${arrearsTable(input.rows)}`,
    fallbackBody: `${DIRECTOR}\nDepartment of Labour and Pensions\n\n**Report of delinquent contributions for ${month}** (National Pensions Act, s.48(6)(a))\n\n${BANK}, as administrator, reports ${reportable.length === 0 ? "no delinquent contributions" : `${new Set(reportable.map((row) => row.code)).size} Employer(s) with contributions still unpaid`} for ${month}. Collection efforts under s.48(4) have begun and are recorded. Employers that paid late are listed for the interest owed under s.50. Affected employees will be told in writing within 60 days of this report.\n\nDated ${formatDate(input.asOf)}; due by ${formatDate(input.reportBy)}.\n\n${sign}`,
    points: [
      "Formal report to the Director under s.48(6)(a), naming each Employer and what is unpaid.",
      "Say collection has begun and employees will be told within 60 days.",
      "Do not restate amounts in prose beyond the table in the particulars.",
    ],
  };
}

export function chaserPlan(input: {
  period: string;
  employer: { code: string; name: string; contactEmail: string | null };
  rows: ArrearsRow[];
}): DraftPlan {
  const month = formatPeriod(input.period);
  const unpaid = input.rows.some((row) => row.reportable);
  return {
    kind: "employer_chaser",
    title: `Chaser: ${input.employer.name} · ${month}`,
    to: input.employer.contactEmail ?? input.employer.name,
    risk: "low",
    particulars: `**Particulars**\n\n${arrearsTable(input.rows)}`,
    fallbackBody: `Dear ${input.employer.name} payroll team,\n\n${unpaid ? `Contributions for ${month} are still outstanding as set out below. Please pay the amount due, with interest, at once. If they remain unpaid we must report them to the Director of Labour and Pensions.` : `Your contributions for ${month} arrived after the due date. Interest is owed for the days late, as set out below; please pay it with your next remittance.`}\n\nKind regards,\n${sign}`,
    points: [
      unpaid
        ? "Firm request to pay now; mention the report to the Director if unpaid."
        : "Polite note that interest is owed for paying late.",
    ],
  };
}
