import type { Check } from "../apply";
import { num } from "../apply";
import {
  dayAfterPeriod,
  daysBetween,
  formatDate,
  formatKyd,
  formatPeriod,
  round2,
} from "../dates";
import {
  type ArrearsRow,
  arrearsRows,
  arrearsTotals,
  type ComputeFacts,
  type DelinquentEntry,
  type PeriodEmployer,
  type PeriodFacts,
} from "../delinquency-report";

const ACTIVE: ReadonlySet<string> = new Set(["active", "delinquent"]);

const received = (employer: PeriodEmployer) =>
  round2(employer.remittances.reduce((sum, item) => sum + item.amountKyd, 0));

const names = (entries: { name: string }[]) =>
  entries.map((entry) => entry.name).join(", ");

// find_missing ---------------------------------------------------------------------------

const missing: Check<PeriodFacts> = (facts, params) => {
  const due = dayAfterPeriod(facts.period, 1, num(params, "dueDay", 15));
  const expected = facts.employers.filter((employer) =>
    ACTIVE.has(employer.status),
  );
  if (facts.asOf <= due) {
    return {
      met: true,
      summary: `Money for ${formatPeriod(facts.period)} is not due until ${formatDate(due)}.`,
      compared: {
        dueOn: due,
        asOf: facts.asOf,
        employersExpected: expected.length,
      },
    };
  }
  const unpaid: DelinquentEntry[] = expected
    .filter((employer) => employer.remittances.length === 0)
    .map((employer) => ({
      employerId: employer.employerId,
      code: employer.code,
      name: employer.name,
      kind: "unpaid",
      amountKyd: employer.scheduleTotalKyd,
      paidOn: null,
    }));
  return {
    met: unpaid.length === 0,
    summary:
      unpaid.length === 0
        ? `Every active Employer remitted for ${formatPeriod(facts.period)}.`
        : `Nothing received by ${formatDate(due)} from ${names(unpaid)}.`,
    compared: {
      dueOn: due,
      asOf: facts.asOf,
      employersExpected: expected.length,
      employers: unpaid,
    },
  };
};

const short: Check<PeriodFacts> = (facts, params) => {
  const tolerance = num(params, "tolerance", 0.01);
  const shortPaid: (DelinquentEntry & {
    scheduleTotalKyd: number;
    receivedKyd: number;
  })[] = [];
  for (const employer of facts.employers) {
    if (employer.remittances.length === 0 || employer.scheduleTotalKyd === null)
      continue;
    const got = received(employer);
    const gap = round2(employer.scheduleTotalKyd - got);
    if (gap > tolerance + 1e-9) {
      shortPaid.push({
        employerId: employer.employerId,
        code: employer.code,
        name: employer.name,
        kind: "short",
        amountKyd: gap,
        paidOn: null,
        scheduleTotalKyd: employer.scheduleTotalKyd,
        receivedKyd: got,
      });
    }
  }
  return {
    met: shortPaid.length === 0,
    summary:
      shortPaid.length === 0
        ? "Everyone who paid, paid their Schedule in full."
        : shortPaid
            .map(
              (entry) =>
                `${entry.name} paid ${formatKyd(entry.receivedKyd)} of ${formatKyd(entry.scheduleTotalKyd)} (short ${formatKyd(entry.amountKyd ?? 0)})`,
            )
            .join("; ")
            .concat("."),
    compared: { toleranceKyd: tolerance, employers: shortPaid },
  };
};

// find_late --------------------------------------------------------------------------------

const late: Check<PeriodFacts> = (facts, params) => {
  const due = dayAfterPeriod(facts.period, 1, num(params, "dueDay", 15));
  const latePaid: (DelinquentEntry & { daysLate: number })[] = [];
  for (const employer of facts.employers) {
    const after = employer.remittances.filter((item) => item.receivedOn > due);
    if (after.length === 0) continue;
    const paidOn = after
      .map((item) => item.receivedOn)
      .sort()
      .at(-1) as string;
    latePaid.push({
      employerId: employer.employerId,
      code: employer.code,
      name: employer.name,
      kind: "late",
      amountKyd: round2(after.reduce((sum, item) => sum + item.amountKyd, 0)),
      paidOn,
      daysLate: daysBetween(due, paidOn),
    });
  }
  return {
    met: latePaid.length === 0,
    summary:
      latePaid.length === 0
        ? `Nothing arrived after ${formatDate(due)}.`
        : latePaid
            .map(
              (entry) =>
                `${entry.name} paid ${formatKyd(entry.amountKyd ?? 0)} on ${formatDate(entry.paidOn as string)}, ${entry.daysLate} days late`,
            )
            .join("; ")
            .concat("."),
    compared: { dueOn: due, employers: latePaid },
  };
};

// compute ------------------------------------------------------------------------------------

/** The arrears rows a compute check works from, at the Rule's rate. */
export function rowsFor(facts: ComputeFacts, ratePct: number): ArrearsRow[] {
  return arrearsRows({
    entries: facts.entries,
    period: facts.period,
    asOf: facts.asOf,
    dueDay: facts.dueDay,
    ratePct,
  });
}

/** The yearly interest rate a Run applies: prime plus the margin. */
export function interestRate(params: Record<string, unknown>): number {
  const prime = typeof params.primeRate === "number" ? params.primeRate : 0;
  const margin = typeof params.margin === "number" ? params.margin : 0;
  return round2(prime + margin);
}

const interest: Check<ComputeFacts> = (facts, params) => {
  const ratePct = interestRate(params);
  const rows = rowsFor(facts, ratePct);
  const totals = arrearsTotals(rows);
  const owing = rows.filter((row) => (row.interestKyd ?? 0) > 0);
  return {
    met: owing.length === 0,
    summary:
      owing.length === 0
        ? "No interest is owed for the month."
        : `Interest of ${formatKyd(totals.interestKyd)} at ${ratePct}% a year is owed by ${names([...new Map(owing.map((row) => [row.code, row])).values()])}.`,
    compared: {
      ratePct,
      primeRatePct: params.primeRate,
      marginPct: params.margin,
      basis: "amount × rate × days ÷ 365, from the day after the due date",
      rows: rows.map((row) => ({
        code: row.code,
        kind: row.kind,
        amountKyd: row.amountKyd,
        dueOn: row.dueOn,
        daysLate: row.daysLate,
        interestKyd: row.interestKyd,
      })),
      totalInterestKyd: totals.interestKyd,
    },
  };
};

const reportDeadline: Check<ComputeFacts> = (facts, params) => {
  const reportableOn = dayAfterPeriod(
    facts.period,
    2,
    num(params, "reportableDay", 15),
  );
  const reportBy = dayAfterPeriod(
    facts.period,
    2,
    num(params, "reportDay", 20),
  );
  const reportable = [
    ...new Map(
      facts.entries
        .filter((entry) => entry.kind !== "late")
        .map((entry) => [entry.code, entry]),
    ).values(),
  ];
  const compared = {
    reportableOn,
    reportBy,
    asOf: facts.asOf,
    reportable: reportable.map((entry) => entry.code),
  };
  if (reportable.length === 0) {
    return {
      met: true,
      summary: "Nothing is reportable to the Director.",
      compared,
    };
  }
  if (facts.asOf < reportableOn) {
    return {
      met: true,
      summary: `${names(reportable)} become reportable on ${formatDate(reportableOn)} if still unpaid; the report is due by ${formatDate(reportBy)}.`,
      compared,
    };
  }
  const left = daysBetween(facts.asOf, reportBy);
  return {
    met: left >= 0,
    summary:
      left >= 0
        ? `Report ${names(reportable)} to the Director by ${formatDate(reportBy)}: ${left} day${left === 1 ? "" : "s"} left.`
        : `The report on ${names(reportable)} was due by ${formatDate(reportBy)}: ${-left} day${left === -1 ? "" : "s"} late.`,
    compared: { ...compared, daysLeft: left },
  };
};

/** The delinquency checks, by Step and Rule id. */
export const DELINQUENCY_CHECKS = {
  find_missing: { "dr.missing": missing, "dr.short": short },
  find_late: { "dr.late": late },
  compute: { "dr.interest": interest, "dr.report-deadline": reportDeadline },
} satisfies {
  find_missing: Record<string, Check<PeriodFacts>>;
  find_late: Record<string, Check<PeriodFacts>>;
  compute: Record<string, Check<ComputeFacts>>;
};
