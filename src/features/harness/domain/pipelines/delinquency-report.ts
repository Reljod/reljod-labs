import type { PipelineSpec } from "../pipeline";
import type { FindingDraft } from "./apply";
import type { RemittanceIn } from "./contribution-processing";
import { dayAfterPeriod, daysBetween, round2 } from "./dates";

/**
 * The monthly delinquency report: find the Employers that did not pay, paid
 * short or paid late, work out arrears and interest in code, and draft the
 * report to the Director and a chaser to each Employer.
 */
export const DELINQUENCY_REPORT: PipelineSpec = {
  id: "delinquency_report",
  title: "Delinquency report",
  summary:
    "Finds the Employers that did not remit for a month, remitted short or late, works out arrears and interest in code, and drafts the report to the Director of Labour and Pensions and a chaser to each Employer.",
  inputSchema: [
    {
      name: "period",
      type: "month",
      required: true,
      description: "The contribution month to report on (YYYY-MM).",
    },
  ],
  steps: [
    {
      id: "load_period",
      title: "Load the month",
      kind: "code",
      after: [],
      summary:
        "Loads every Employer's Schedule and the money received for the month.",
    },
    {
      id: "find_missing",
      title: "Find unpaid",
      kind: "code",
      after: ["load_period"],
      summary:
        "Employers with nothing received after the due date, or paid short.",
    },
    {
      id: "find_late",
      title: "Find late",
      kind: "code",
      after: ["load_period"],
      summary: "Employers whose money arrived after the due date.",
    },
    {
      id: "compute",
      title: "Compute arrears",
      kind: "code",
      after: ["find_missing", "find_late"],
      summary:
        "Days late, arrears and interest at the Rule's rate, with their inputs.",
    },
    {
      id: "draft_report",
      title: "Draft the report",
      kind: "model",
      after: ["compute"],
      summary: "Writes the report to the Director, due by the 20th.",
    },
    {
      id: "draft_chasers",
      title: "Draft chasers",
      kind: "model",
      after: ["compute"],
      summary: "Writes one chaser per delinquent Employer, at the same time.",
    },
    {
      id: "approval",
      title: "Approval",
      kind: "approval",
      after: ["draft_report", "draft_chasers"],
      risk: "high",
      summary:
        "An admin who did not start the Run approves the report to the regulator.",
    },
    {
      id: "file",
      title: "File",
      kind: "code",
      after: ["approval"],
      summary:
        "Records the report as filed and marks the Employers delinquent.",
    },
  ],
  skillId: "delinquency-report",
  rulebookSkillId: "delinquency-report-rules",
};

/** One Employer's month as `load_period` found it. */
export type PeriodEmployer = {
  employerId: string;
  code: string;
  name: string;
  status: string;
  contactEmail: string | null;
  /** The Schedule's total, or null when no Schedule came in. */
  scheduleTotalKyd: number | null;
  remittances: RemittanceIn[];
};

export type PeriodFacts = {
  asOf: string;
  period: string;
  employers: PeriodEmployer[];
};

export type DelinquencyKind = "unpaid" | "short" | "late";

/** One Employer's problem for the month, as the find Steps report it in `compared.employers`. */
export type DelinquentEntry = {
  employerId: string;
  code: string;
  name: string;
  kind: DelinquencyKind;
  /** The money the interest runs on; null when there is no Schedule to say. */
  amountKyd: number | null;
  /** When it was paid, for `late`; null while unpaid. */
  paidOn: string | null;
};

/** A DelinquentEntry with the arithmetic done, inputs shown. */
export type ArrearsRow = DelinquentEntry & {
  dueOn: string;
  /** Up to the payment for `late`; up to the Run's date otherwise. */
  daysLate: number;
  ratePct: number;
  interestKyd: number | null;
  /** Still unpaid, so reportable to the Director. */
  reportable: boolean;
};

/** Entries the find Steps reported, in Employer order. */
export function entriesOf(findings: FindingDraft[]): DelinquentEntry[] {
  return findings
    .filter((finding) => !finding.met)
    .flatMap((finding) => {
      const employers = finding.compared.employers;
      return Array.isArray(employers) ? (employers as DelinquentEntry[]) : [];
    })
    .sort(
      (a, b) => a.code.localeCompare(b.code) || a.kind.localeCompare(b.kind),
    );
}

/**
 * Interest on each entry: amount × rate × days / 365, counted from the day
 * after the due date to the payment (late) or the Run's date (unpaid,
 * short). Pure; every input is on the row.
 */
export function arrearsRows(input: {
  entries: DelinquentEntry[];
  period: string;
  asOf: string;
  dueDay: number;
  ratePct: number;
}): ArrearsRow[] {
  const dueOn = dayAfterPeriod(input.period, 1, input.dueDay);
  return input.entries.map((entry) => {
    const until =
      entry.kind === "late" && entry.paidOn ? entry.paidOn : input.asOf;
    const daysLate = Math.max(0, daysBetween(dueOn, until));
    const interestKyd =
      entry.amountKyd === null
        ? null
        : round2((entry.amountKyd * input.ratePct * daysLate) / 100 / 365);
    return {
      ...entry,
      dueOn,
      daysLate,
      ratePct: input.ratePct,
      interestKyd,
      reportable: entry.kind !== "late",
    };
  });
}

export function arrearsTotals(rows: ArrearsRow[]) {
  const unpaid = rows.filter((row) => row.reportable);
  return {
    employers: new Set(rows.map((row) => row.code)).size,
    reportableEmployers: new Set(unpaid.map((row) => row.code)).size,
    arrearsKyd: round2(
      unpaid.reduce((sum, row) => sum + (row.amountKyd ?? 0), 0),
    ),
    interestKyd: round2(
      rows.reduce((sum, row) => sum + (row.interestKyd ?? 0), 0),
    ),
  };
}

/** What the compute Step's checks look at. */
export type ComputeFacts = {
  asOf: string;
  period: string;
  /** The due day the Run applies (`dr.missing`). */
  dueDay: number;
  entries: DelinquentEntry[];
};
