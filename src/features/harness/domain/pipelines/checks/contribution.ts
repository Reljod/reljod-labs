import type { Check, CheckResult } from "../apply";
import { num } from "../apply";
import type {
  CapFacts,
  CoverageFacts,
  LineProblem,
  MatchFacts,
  RateFacts,
  RemittanceFacts,
} from "../contribution-processing";
import {
  addMonths,
  dayAfterPeriod,
  daysBetween,
  formatDate,
  formatKyd,
  formatPeriod,
  periodEnd,
  periodStart,
  round2,
  wholeYearsBetween,
} from "../dates";
import type { ScheduleLineIn } from "../schedule";

/** How many problem lines a Finding keeps in `compared`. */
const KEEP = 25;

const problem = (line: ScheduleLineIn, detail: string): LineProblem => ({
  line: line.line,
  memberNo: line.memberNo,
  memberName: line.memberName || null,
  detail,
});

function linesResult(
  problems: LineProblem[],
  checked: number,
  ok: string,
  bad: (count: number) => string,
  extra: Record<string, unknown> = {},
): CheckResult {
  return {
    met: problems.length === 0,
    summary: problems.length === 0 ? ok : bad(problems.length),
    compared: {
      linesChecked: checked,
      problems: problems.length,
      lines: problems.slice(0, KEEP),
      ...extra,
    },
  };
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

// match_members ----------------------------------------------------------------------

const knownMember: Check<MatchFacts> = (facts) => {
  const problems = facts.lines
    .filter((line) => !facts.members[line.memberNo])
    .map((line) =>
      problem(line, `${line.memberNo} is not a Member of the plan.`),
    );
  return linesResult(
    problems,
    facts.lines.length,
    `All ${facts.lines.length} lines name a Member of the plan.`,
    (count) => `${plural(count, "line")} name no Member of the plan.`,
  );
};

const LEFT: ReadonlySet<string> = new Set(["closed", "retired", "deceased"]);

const noTerminated: Check<MatchFacts> = (facts) => {
  const start = periodStart(facts.period);
  const problems: LineProblem[] = [];
  for (const line of facts.lines) {
    const member = facts.members[line.memberNo];
    if (!member) continue;
    if (LEFT.has(member.status)) {
      problems.push(problem(line, `The account is ${member.status}.`));
    } else if (member.employmentEndedOn && member.employmentEndedOn < start) {
      problems.push(
        problem(
          line,
          `Employment ended on ${formatDate(member.employmentEndedOn)}, before ${formatPeriod(facts.period)}.`,
        ),
      );
    } else if (
      facts.employerId &&
      member.employerId &&
      member.employerId !== facts.employerId
    ) {
      problems.push(
        problem(line, "The Member is recorded with another Employer."),
      );
    }
  }
  return linesResult(
    problems,
    facts.lines.length,
    "No line is for a leaver or a closed account.",
    (count) =>
      `${plural(count, "line")} are for Members who have left or are with another Employer.`,
  );
};

const noDuplicates: Check<MatchFacts> = (facts) => {
  const seen = new Map<string, number>();
  const problems: LineProblem[] = [];
  for (const line of facts.lines) {
    const before = seen.get(line.memberNo);
    if (before !== undefined) {
      problems.push(problem(line, `Also on line ${before}.`));
    } else seen.set(line.memberNo, line.line);
  }
  return linesResult(
    problems,
    facts.lines.length,
    "Each Member appears once.",
    (count) => `${plural(count, "line")} repeat a Member already listed.`,
  );
};

// check_rates --------------------------------------------------------------------------

/** Earnings counted for mandatory contributions: up to one twelfth of the yearly cap. */
export function pensionable(earnings: number, annualCap: number): number {
  return round2(Math.min(earnings, annualCap / 12));
}

/** A cent of slack, so an amount rounded either way passes. */
const CENT = 0.01 + 1e-9;

const employerRate: Check<RateFacts> = (facts, params) => {
  const rate = num(params, "minRate", 5);
  const problems: LineProblem[] = [];
  for (const line of facts.lines) {
    const base = pensionable(line.earningsKyd, facts.annualCapKyd);
    const expected = round2((base * rate) / 100);
    if (line.employerKyd < expected - CENT) {
      problems.push(
        problem(
          line,
          `Employer paid ${formatKyd(line.employerKyd)}; at ${rate}% of ${formatKyd(base)} it owes at least ${formatKyd(expected)} (short ${formatKyd(expected - line.employerKyd)}).`,
        ),
      );
    }
  }
  return linesResult(
    problems,
    facts.lines.length,
    `The Employer pays at least ${rate}% on every line.`,
    (count) => `The Employer pays under ${rate}% on ${plural(count, "line")}.`,
    { minRatePct: rate, annualCapKyd: facts.annualCapKyd },
  );
};

const employeeRate: Check<RateFacts> = (facts, params) => {
  const rate = num(params, "maxRate", 5);
  const problems: LineProblem[] = [];
  for (const line of facts.lines) {
    const base = pensionable(line.earningsKyd, facts.annualCapKyd);
    const ceiling = round2((base * rate) / 100);
    if (line.employeeKyd > ceiling + CENT) {
      problems.push(
        problem(
          line,
          `Deducted ${formatKyd(line.employeeKyd)}; at most ${rate}% of ${formatKyd(base)} is ${formatKyd(ceiling)}.`,
        ),
      );
    }
  }
  return linesResult(
    problems,
    facts.lines.length,
    `No Member has more than ${rate}% deducted.`,
    (count) =>
      `${plural(count, "line")} deduct more than ${rate}% from the Member.`,
    { maxRatePct: rate, annualCapKyd: facts.annualCapKyd },
  );
};

const totalRate: Check<RateFacts> = (facts, params) => {
  const rate = num(params, "totalRate", 10);
  const tolerance = num(params, "tolerance", 0.01);
  const problems: LineProblem[] = [];
  for (const line of facts.lines) {
    const base = pensionable(line.earningsKyd, facts.annualCapKyd);
    const expected = round2((base * rate) / 100);
    const paid = round2(line.employeeKyd + line.employerKyd);
    if (Math.abs(paid - expected) > tolerance + 1e-9) {
      problems.push(
        problem(
          line,
          `Paid ${formatKyd(paid)} in all; ${rate}% of ${formatKyd(base)} is ${formatKyd(expected)} (${paid < expected ? "short" : "over"} ${formatKyd(Math.abs(paid - expected))}).`,
        ),
      );
    }
  }
  return linesResult(
    problems,
    facts.lines.length,
    `Every line pays ${rate}% of pensionable earnings in all.`,
    (count) => `${plural(count, "line")} do not add up to ${rate}%.`,
    {
      totalRatePct: rate,
      toleranceKyd: tolerance,
      annualCapKyd: facts.annualCapKyd,
    },
  );
};

// check_cap ------------------------------------------------------------------------------

const ympeCap: Check<CapFacts> = (facts, params) => {
  const annual = num(params, "annualCap", 87_000);
  const monthly = round2(annual / 12);
  const mandatoryMax = round2((monthly * facts.totalRatePct) / 100);
  const above = facts.lines.filter((line) => line.earningsKyd > monthly);
  const problems: LineProblem[] = [];
  for (const line of above) {
    const paid = round2(line.employeeKyd + line.employerKyd);
    if (paid > mandatoryMax + 0.01) {
      problems.push(
        problem(
          line,
          `Earnings ${formatKyd(line.earningsKyd)} are over the monthly cap of ${formatKyd(monthly)}; ${formatKyd(paid - mandatoryMax)} of the ${formatKyd(paid)} paid counts as voluntary.`,
        ),
      );
    }
  }
  return linesResult(
    problems,
    facts.lines.length,
    above.length === 0
      ? `No earnings are over the monthly cap of ${formatKyd(monthly)}.`
      : `${plural(above.length, "line")} over the monthly cap of ${formatKyd(monthly)} ${above.length === 1 ? "is" : "are"} capped correctly.`,
    (count) =>
      `${plural(count, "line")} pay mandatory contributions on earnings over the cap.`,
    {
      annualCapKyd: annual,
      monthlyCapKyd: monthly,
      mandatoryMaxKyd: mandatoryMax,
      linesAboveCap: above.length,
    },
  );
};

// check_coverage -------------------------------------------------------------------------

const coverageAge: Check<CoverageFacts> = (facts, params) => {
  const minAge = num(params, "minAge", 18);
  const maxAge = num(params, "maxAge", 65);
  const end = periodEnd(facts.period);
  const problems: LineProblem[] = [];
  for (const line of facts.lines) {
    const born = facts.members[line.memberNo]?.dateOfBirth;
    if (!born) continue;
    const age = wholeYearsBetween(born, end);
    if (age < minAge || age >= maxAge) {
      problems.push(
        problem(
          line,
          `Aged ${age} at the end of ${formatPeriod(facts.period)}: contributions are voluntary${age >= maxAge ? ` from ${maxAge}` : ` under ${minAge}`}.`,
        ),
      );
    }
  }
  return linesResult(
    problems,
    facts.lines.length,
    `Every Member on the Schedule is ${minAge} to ${maxAge - 1}.`,
    (count) =>
      `${plural(count, "line")} are for Members outside ages ${minAge} to ${maxAge - 1}.`,
    { minAge, maxAge, asAt: end },
  );
};

const nineMonth: Check<CoverageFacts> = (facts, params) => {
  const months = num(params, "months", 9);
  const end = periodEnd(facts.period);
  const problems: LineProblem[] = [];
  for (const line of facts.lines) {
    const member = facts.members[line.memberNo];
    if (!member || member.caymanian) continue;
    if (member.residencyStatus === "permanent_resident") continue;
    if (!member.startedWorkOn) continue;
    const coveredFrom = addMonths(member.startedWorkOn, months);
    if (end <= coveredFrom) {
      problems.push(
        problem(
          line,
          `Started work in the Islands on ${formatDate(member.startedWorkOn)}; cover is required only after ${formatDate(coveredFrom)}, so these contributions are voluntary.`,
        ),
      );
    }
  }
  return linesResult(
    problems,
    facts.lines.length,
    `No line is for a non-Caymanian inside the ${months}-month wait.`,
    (count) =>
      `${plural(count, "line")} are for non-Caymanians inside the ${months}-month wait.`,
    { months, asAt: end },
  );
};

// match_remittance -----------------------------------------------------------------------

const remittanceTotal: Check<RemittanceFacts> = (facts, params) => {
  const tolerance = num(params, "tolerance", 0.01);
  const received = round2(
    facts.remittances.reduce((sum, item) => sum + item.amountKyd, 0),
  );
  const difference = round2(received - facts.scheduleTotalKyd);
  if (facts.remittances.length === 0) {
    return {
      met: false,
      summary: `No money has been received for ${formatPeriod(facts.period)}; the Schedule totals ${formatKyd(facts.scheduleTotalKyd)}.`,
      compared: {
        scheduleTotalKyd: facts.scheduleTotalKyd,
        receivedKyd: 0,
        differenceKyd: -facts.scheduleTotalKyd,
        toleranceKyd: tolerance,
      },
    };
  }
  const met = Math.abs(difference) <= tolerance + 1e-9;
  return {
    met,
    summary: met
      ? `${formatKyd(received)} received matches the Schedule's ${formatKyd(facts.scheduleTotalKyd)}.`
      : `${formatKyd(received)} received against the Schedule's ${formatKyd(facts.scheduleTotalKyd)}: ${difference < 0 ? "short" : "over"} ${formatKyd(Math.abs(difference))}.`,
    compared: {
      scheduleTotalKyd: facts.scheduleTotalKyd,
      receivedKyd: received,
      differenceKyd: difference,
      toleranceKyd: tolerance,
      remittances: facts.remittances,
    },
  };
};

const remittanceOnTime: Check<RemittanceFacts> = (facts, params) => {
  const dueDay = num(params, "dueDay", 15);
  const due = dayAfterPeriod(facts.period, 1, dueDay);
  if (facts.remittances.length === 0) {
    const overdue = facts.asOf > due;
    return {
      met: !overdue,
      summary: overdue
        ? `Nothing received; it was due by ${formatDate(due)}.`
        : `Not received yet; due by ${formatDate(due)}.`,
      compared: { dueOn: due, asOf: facts.asOf, lastReceivedOn: null },
    };
  }
  const last = facts.remittances
    .map((item) => item.receivedOn)
    .sort()
    .at(-1) as string;
  const late = daysBetween(due, last);
  return {
    met: late <= 0,
    summary:
      late <= 0
        ? `Received on ${formatDate(last)}, by the due date of ${formatDate(due)}.`
        : `Received on ${formatDate(last)}, ${plural(late, "day")} after the due date of ${formatDate(due)}.`,
    compared: { dueOn: due, lastReceivedOn: last, daysLate: Math.max(0, late) },
  };
};

/** The contribution checks, by Step and Rule id. */
export const CONTRIBUTION_CHECKS = {
  match_members: {
    "cp.known-member": knownMember,
    "cp.no-terminated": noTerminated,
    "cp.no-duplicates": noDuplicates,
  },
  check_rates: {
    "cp.employer-rate": employerRate,
    "cp.employee-rate": employeeRate,
    "cp.total-rate": totalRate,
  },
  check_cap: { "cp.ympe-cap": ympeCap },
  check_coverage: {
    "cp.coverage-age": coverageAge,
    "cp.nine-month": nineMonth,
  },
  match_remittance: {
    "cp.remittance-total": remittanceTotal,
    "cp.remittance-on-time": remittanceOnTime,
  },
} satisfies {
  match_members: Record<string, Check<MatchFacts>>;
  check_rates: Record<string, Check<RateFacts>>;
  check_cap: Record<string, Check<CapFacts>>;
  check_coverage: Record<string, Check<CoverageFacts>>;
  match_remittance: Record<string, Check<RemittanceFacts>>;
};
