import type { Outcome } from "../rules";
import type { FindingDraft } from "./apply";
import type { LineProblem } from "./contribution-processing";
import { round2 } from "./dates";
import type { ScheduleLineIn } from "./schedule";

export type ExceptionRow = LineProblem & { ruleId: string; outcome: Outcome };

export type ScheduleTotals = {
  lines: number;
  earningsKyd: number;
  employeeKyd: number;
  employerKyd: number;
  voluntaryKyd: number;
  totalKyd: number;
  receivedKyd: number;
  differenceKyd: number;
};

/** `post` when nothing holds the Schedule; `hold` when an exception does. */
export type ScheduleDecision = "post" | "hold";

export type Reconciliation = {
  decision: ScheduleDecision;
  /** Rules not met that block or refer, line by line where the check named lines. */
  exceptions: ExceptionRow[];
  /** Rules not met that only warn. */
  warnings: ExceptionRow[];
  totals: ScheduleTotals;
  /** Problems reading the file, which also hold it. */
  readProblems: string[];
};

function rowsOf(finding: FindingDraft): ExceptionRow[] {
  const lines = finding.compared.lines;
  if (Array.isArray(lines) && lines.length > 0) {
    return (lines as LineProblem[]).map((line) => ({
      ...line,
      ruleId: finding.ruleId,
      outcome: finding.outcome,
    }));
  }
  return [
    {
      line: null,
      memberNo: null,
      memberName: null,
      detail: finding.summary,
      ruleId: finding.ruleId,
      outcome: finding.outcome,
    },
  ];
}

/**
 * The exceptions table and the totals of one Schedule, from the Findings of
 * the checks that ran on it. Any unmet Rule that blocks or refers, or a line
 * that could not be read, holds the Schedule. Pure.
 */
export function reconcile(input: {
  lines: ScheduleLineIn[];
  findings: FindingDraft[];
  receivedKyd: number;
  readProblems: string[];
}): Reconciliation {
  const sum = (pick: (line: ScheduleLineIn) => number) =>
    round2(input.lines.reduce((total, line) => total + pick(line), 0));
  const employee = sum((line) => line.employeeKyd);
  const employer = sum((line) => line.employerKyd);
  const voluntary = sum((line) => line.voluntaryKyd);
  const total = round2(employee + employer + voluntary);
  const unmet = input.findings.filter((finding) => !finding.met);
  const exceptions = unmet
    .filter((finding) => finding.outcome !== "warn")
    .flatMap(rowsOf);
  const warnings = unmet
    .filter((finding) => finding.outcome === "warn")
    .flatMap(rowsOf);
  return {
    decision:
      exceptions.length > 0 || input.readProblems.length > 0 ? "hold" : "post",
    exceptions,
    warnings,
    totals: {
      lines: input.lines.length,
      earningsKyd: sum((line) => line.earningsKyd),
      employeeKyd: employee,
      employerKyd: employer,
      voluntaryKyd: voluntary,
      totalKyd: total,
      receivedKyd: round2(input.receivedKyd),
      differenceKyd: round2(input.receivedKyd - total),
    },
    readProblems: input.readProblems,
  };
}
