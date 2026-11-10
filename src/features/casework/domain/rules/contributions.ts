import {
  ageOn,
  daysBetween,
  dueDate,
  formatDate,
  formatMoney,
  isoDate,
} from "../dates";
import { nameWords } from "../names";
import { RULEBOOK } from "../rulebook";
import {
  type Arrears,
  type ArrearsMonth,
  type Check,
  documentsOf,
  firstOf,
  list,
  money,
  type RunState,
  text,
} from "../run-state";
import type { JobOutcome } from "./types";

type CensusRow = {
  employee_id?: string;
  full_name?: string;
  date_of_birth?: string;
  hire_date?: string;
  monthly_salary?: number | string;
  id_number?: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** check_census: duplicates, impossible or out-of-range dates of birth, missing data. */
export function checkCensus(state: RunState): JobOutcome {
  const census = firstOf(state, "member_census");
  if (!census) return { checks: [], summary: "No census to check" };
  const rows = list<CensusRow>(census, "members");
  const fails: string[] = [];
  const reviews: string[] = [];

  const seen = new Map<string, string>();
  for (const row of rows) {
    const name = row.full_name ?? row.employee_id ?? "a row";
    const keys = [
      row.id_number
        ? `id:${String(row.id_number).replace(/\W/g, "").toLowerCase()}`
        : "",
      row.full_name && row.date_of_birth
        ? `nd:${nameWords(row.full_name).sort().join(" ")}|${row.date_of_birth}`
        : "",
    ].filter(Boolean);
    const duplicate = keys.map((key) => seen.get(key)).find(Boolean);
    if (duplicate)
      fails.push(
        `${name} appears twice (${duplicate} and ${row.employee_id ?? "?"})`,
      );
    for (const key of keys) seen.set(key, row.employee_id ?? name);

    const dob = isoDate(row.date_of_birth ?? "");
    if (!row.date_of_birth) {
      reviews.push(`${name} has no date of birth`);
    } else if (!dob) {
      fails.push(
        `${name}'s date of birth ${row.date_of_birth} is not a real date`,
      );
    } else {
      const age = ageOn(dob, state.asOf);
      if (age < 18) fails.push(`${name} is ${age}, under 18`);
      else if (age > 75) reviews.push(`${name} is ${age}, over 75`);
    }
    const salary =
      typeof row.monthly_salary === "number"
        ? row.monthly_salary
        : Number(row.monthly_salary);
    if (!salary) reviews.push(`${name} has no salary`);
  }

  const application = firstOf(state, "employer_application");
  const declared = money(application, "employee_count");
  if (declared && declared !== rows.length) {
    reviews.push(`${rows.length} rows against ${declared} employees declared`);
  }

  const outcome: Check["outcome"] =
    fails.length > 0 ? "fail" : reviews.length > 0 ? "review" : "pass";
  const issues = [...fails, ...reviews];
  const detail =
    outcome === "pass"
      ? `${rows.length} members, no duplicates, every date of birth valid`
      : issues.slice(0, 3).join("; ") +
        (issues.length > 3 ? `; and ${issues.length - 3} more` : "");
  return {
    checks: [
      {
        id: "census_valid",
        outcome,
        detail,
        job: "check_census",
        evidence: [{ documentId: census.id, field: "members" }],
      },
    ],
    summary: `${rows.length} members checked${issues.length ? `, ${issues.length} issue${issues.length === 1 ? "" : "s"}` : ""}`,
  };
}

type Line = {
  period?: string;
  employee_id?: string;
  full_name?: string;
  gross_earnings?: number | string;
  employee_contribution?: number | string;
  employer_contribution?: number | string;
  date_paid?: string;
};

const num = (value: unknown) => {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Simple interest at prime + 5% on actual days over 365. */
export function lateInterest(amount: number, days: number) {
  return round2((amount * RULEBOOK.lateInterestRate * Math.max(0, days)) / 365);
}

/** reconcile: every line recomputed, every month's payment dated and totalled. */
export function reconcile(state: RunState): JobOutcome {
  const schedules = documentsOf(state, "contribution_schedule").filter(
    (document) => document.fields,
  );
  if (schedules.length === 0) {
    return { checks: [], summary: "No contribution schedule to reconcile" };
  }
  const lines = schedules.flatMap((schedule) => list<Line>(schedule, "lines"));
  const remittances = documentsOf(state, "remittance_advice").filter(
    (document) => document.fields,
  );

  const rateProblems: string[] = [];
  const byPeriod = new Map<string, Line[]>();
  for (const line of lines) {
    const period = String(line.period ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), line]);
    const pensionable = Math.min(
      num(line.gross_earnings),
      RULEBOOK.monthlyEarningsCap,
    );
    const employee = round2(pensionable * RULEBOOK.employeeRate);
    const employer = round2(pensionable * RULEBOOK.employerRate);
    const gapEmployee = round2(employee - num(line.employee_contribution));
    const gapEmployer = round2(employer - num(line.employer_contribution));
    if (
      gapEmployee > RULEBOOK.centsTolerance ||
      gapEmployer > RULEBOOK.centsTolerance
    ) {
      rateProblems.push(
        `${line.full_name ?? line.employee_id} ${period}: ${formatMoney(num(line.employee_contribution))} + ${formatMoney(num(line.employer_contribution))} against ${formatMoney(employee)} + ${formatMoney(employer)} due`,
      );
    }
  }

  const months: ArrearsMonth[] = [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, periodLines]) => {
      const due = dueDate(period, RULEBOOK.dueDay);
      const expected = round2(
        periodLines.reduce((sum, line) => {
          const pensionable = Math.min(
            num(line.gross_earnings),
            RULEBOOK.monthlyEarningsCap,
          );
          return (
            sum +
            round2(pensionable * RULEBOOK.employeeRate) +
            round2(pensionable * RULEBOOK.employerRate)
          );
        }, 0),
      );
      const paidLines = periodLines.filter((line) =>
        isoDate(line.date_paid ?? ""),
      );
      const fromLines = round2(
        paidLines.reduce(
          (sum, line) =>
            sum +
            num(line.employee_contribution) +
            num(line.employer_contribution),
          0,
        ),
      );
      const remittance = remittances.filter(
        (document) => text(document, "period").slice(0, 7) === period,
      );
      const remitted = round2(
        remittance.reduce(
          (sum, document) => sum + (money(document, "amount") ?? 0),
          0,
        ),
      );
      const paid =
        remittance.length > 0
          ? Math.min(remitted, fromLines || remitted)
          : fromLines;
      const paidOn =
        remittance
          .map((document) => isoDate(text(document, "value_date")))
          .find(Boolean) ??
        paidLines
          .map((line) => isoDate(line.date_paid ?? ""))
          .sort()
          .at(-1) ??
        null;
      const short = round2(Math.max(0, expected - paid));
      const daysLate = paidOn ? Math.max(0, daysBetween(due, paidOn)) : 0;
      const overdue =
        short > RULEBOOK.centsTolerance
          ? Math.max(0, daysBetween(due, state.asOf))
          : 0;
      return {
        period,
        due,
        expected,
        paid: round2(paid),
        short: short > RULEBOOK.centsTolerance ? short : 0,
        daysLate,
        interest: round2(
          lateInterest(paid, daysLate) + lateInterest(short, overdue),
        ),
      };
    });

  const arrears: Arrears = {
    months,
    total: round2(months.reduce((sum, month) => sum + month.short, 0)),
    interest: round2(months.reduce((sum, month) => sum + month.interest, 0)),
  };
  const late = months.filter((month) => month.daysLate > 0);
  const evidence = schedules.map((schedule) => ({
    documentId: schedule.id,
    field: "lines",
  }));
  const checks: Check[] = [
    {
      id: "contributions_at_rate",
      outcome: rateProblems.length === 0 ? "pass" : "fail",
      detail:
        rateProblems.length === 0
          ? `${lines.length} lines at 5% + 5% of earnings capped at ${formatMoney(RULEBOOK.monthlyEarningsCap)}`
          : `${rateProblems.length} line${rateProblems.length === 1 ? "" : "s"} short, e.g. ${rateProblems[0]}`,
      job: "reconcile",
      evidence,
    },
    {
      id: "contributions_on_time",
      outcome: late.length === 0 ? "pass" : "fail",
      detail:
        late.length === 0
          ? `Every month paid by the ${RULEBOOK.dueDay}th`
          : late
              .map(
                (month) =>
                  `${month.period} paid ${month.daysLate} days after ${formatDate(month.due)}`,
              )
              .join("; "),
      job: "reconcile",
      evidence: [
        ...evidence,
        ...remittances.map((document) => ({
          documentId: document.id,
          field: "value_date",
        })),
      ],
    },
    {
      id: "no_arrears",
      outcome: arrears.total > RULEBOOK.centsTolerance ? "fail" : "pass",
      detail:
        arrears.total > RULEBOOK.centsTolerance
          ? `${formatMoney(arrears.total)} owed across ${months
              .filter((month) => month.short > 0)
              .map((month) => month.period)
              .join(
                ", ",
              )}, plus about ${formatMoney(arrears.interest)} interest`
          : `Nothing owed for ${months.map((month) => month.period).join(", ")}`,
      job: "reconcile",
      evidence,
    },
  ];
  return {
    checks,
    patch: { arrears },
    summary:
      arrears.total > 0
        ? `${formatMoney(arrears.total)} in arrears over ${months.length} months`
        : `${months.length} months reconciled, nothing owed`,
  };
}
