import "server-only";
import {
  applyChecks,
  type FindingDraft,
  paramOf,
} from "../../domain/pipelines/apply";
import {
  DELINQUENCY_CHECKS,
  interestRate,
  rowsFor,
} from "../../domain/pipelines/checks/delinquency";
import {
  dayAfterPeriod,
  formatPeriod,
  periodStart,
} from "../../domain/pipelines/dates";
import {
  type ArrearsRow,
  arrearsTotals,
  type ComputeFacts,
  entriesOf,
  type PeriodEmployer,
  type PeriodFacts,
} from "../../domain/pipelines/delinquency-report";
import {
  chaserPlan,
  finishDraft,
  regulatorReportPlan,
} from "../../domain/pipelines/drafts";
import type { Draft } from "../../domain/run";
import { sql } from "../db";
import { writeDraftBody } from "./model";
import {
  type ApprovalOutcome,
  type Deps,
  type Executor,
  type FanOut,
  outputOf,
  type PipelineRunner,
  type RunContext,
  StepProblem,
} from "./types";

const PIPELINE = "delinquency_report" as const;

type CheckOutput = { findings: FindingDraft[]; notMet: number };
type ComputeOutput = {
  rows: ArrearsRow[];
  totals: ReturnType<typeof arrearsTotals>;
  reportableOn: string;
  reportBy: string;
  ratePct: number;
  findings: FindingDraft[];
};
type DraftOutput = { drafts: Draft[]; risk: "low" | "high"; fallback: boolean };

const period = (ctx: RunContext) => ctx.input.period as string;

const loadPeriod: Executor = async (ctx) => {
  const db = sql();
  const start = periodStart(period(ctx));
  const [employers, totals, remittances] = await Promise.all([
    db<
      {
        id: string;
        code: string;
        name: string;
        status: string;
        contact_email: string | null;
      }[]
    >`
      select id, code, name, status, contact_email
      from harness.employers where owner = ${ctx.owner} order by code`,
    db<{ employer_id: string; total: string }[]>`
      select s.employer_id,
             coalesce(sum(l.employee_kyd + l.employer_kyd + l.voluntary_kyd), 0) as total
      from harness.schedules s
      left join harness.schedule_lines l on l.schedule_id = s.id and l.owner = s.owner
      where s.owner = ${ctx.owner} and s.period = ${start}
      group by s.employer_id`,
    db<
      {
        employer_id: string;
        amount_kyd: string;
        received_on: string;
        reference: string | null;
      }[]
    >`
      select employer_id, amount_kyd, received_on::text as received_on, reference
      from harness.remittances
      where owner = ${ctx.owner} and period = ${start}
      order by received_on`,
  ]);
  const totalBy = new Map(
    totals.map((row) => [row.employer_id, Number(row.total)]),
  );
  const facts: PeriodFacts = {
    asOf: ctx.asOf,
    period: period(ctx),
    employers: employers.map(
      (employer): PeriodEmployer => ({
        employerId: employer.id,
        code: employer.code,
        name: employer.name,
        status: employer.status,
        contactEmail: employer.contact_email,
        scheduleTotalKyd: totalBy.get(employer.id) ?? null,
        remittances: remittances
          .filter((row) => row.employer_id === employer.id)
          .map((row) => ({
            amountKyd: Number(row.amount_kyd),
            receivedOn: row.received_on,
            reference: row.reference,
          })),
      }),
    ),
  };
  if (facts.employers.length === 0)
    throw new StepProblem("The plan has no Employers.");
  return {
    output: facts,
    summary: `${facts.employers.length} Employers, ${totals.length} Schedules and ${remittances.length} remittances for ${formatPeriod(period(ctx))}.`,
  };
};

function findStep(stepId: "find_missing" | "find_late"): Executor {
  return async (ctx, deps) => {
    const findings = applyChecks({
      pipelineId: PIPELINE,
      stepId,
      checks: DELINQUENCY_CHECKS[stepId],
      facts: outputOf<PeriodFacts>(deps, "load_period"),
      states: ctx.states,
      asOf: ctx.asOf,
    });
    const notMet = findings.filter((finding) => !finding.met).length;
    return {
      output: { findings, notMet } satisfies CheckOutput,
      findings,
      skipped: findings.length === 0,
      summary: `${findings.length} Rule${findings.length === 1 ? "" : "s"} checked, ${notMet} not met.`,
    };
  };
}

const dueDayOf = (ctx: RunContext) =>
  Number(paramOf(ctx.states, "dr.missing", "dueDay") ?? 15);

const compute: Executor = async (ctx, deps) => {
  const found = ["find_missing", "find_late"].flatMap((stepId) =>
    deps[stepId] ? outputOf<CheckOutput>(deps, stepId).findings : [],
  );
  const facts: ComputeFacts = {
    asOf: ctx.asOf,
    period: period(ctx),
    dueDay: dueDayOf(ctx),
    entries: entriesOf(found),
  };
  const findings = applyChecks({
    pipelineId: PIPELINE,
    stepId: "compute",
    checks: DELINQUENCY_CHECKS.compute,
    facts,
    states: ctx.states,
    asOf: ctx.asOf,
  });
  const interest = ctx.states["dr.interest"];
  const ratePct =
    // Not yet in force (null) or switched off: no interest is charged.
    interest === null || interest?.enabled === false
      ? 0
      : interestRate({
          primeRate: paramOf(ctx.states, "dr.interest", "primeRate"),
          margin: paramOf(ctx.states, "dr.interest", "margin"),
        });
  const rows = rowsFor(facts, ratePct);
  const output: ComputeOutput = {
    rows,
    totals: arrearsTotals(rows),
    reportableOn: dayAfterPeriod(
      period(ctx),
      2,
      Number(paramOf(ctx.states, "dr.report-deadline", "reportableDay") ?? 15),
    ),
    reportBy: dayAfterPeriod(
      period(ctx),
      2,
      Number(paramOf(ctx.states, "dr.report-deadline", "reportDay") ?? 20),
    ),
    ratePct,
    findings,
  };
  return {
    output,
    findings,
    summary: `${output.totals.employers} Employer${output.totals.employers === 1 ? "" : "s"} late or unpaid; arrears CI$${output.totals.arrearsKyd.toFixed(2)}, interest CI$${output.totals.interestKyd.toFixed(2)}.`,
  };
};

const draftReport: Executor = async (ctx, deps) => {
  const computed = outputOf<ComputeOutput>(deps, "compute");
  const plan = regulatorReportPlan({
    period: period(ctx),
    rows: computed.rows,
    reportBy: computed.reportBy,
    asOf: ctx.asOf,
  });
  const context = [
    `Month: ${formatPeriod(period(ctx))}. Report due by ${computed.reportBy}.`,
    ...computed.rows.map((row) => `- ${row.name} (${row.code}): ${row.kind}`),
    ...computed.findings
      .filter((finding) => !finding.met)
      .map((finding) => `Finding: ${finding.summary}`),
  ].join("\n");
  const body = await writeDraftBody({ plan, context, stubbed: ctx.stubbed });
  const written = finishDraft(plan, body.value, "draft_report");
  return {
    output: {
      drafts: [written],
      risk: "high",
      fallback: body.fallback,
    } satisfies DraftOutput,
    usage: body.usage,
    summary: `Drafted the report to the Director${body.fallback ? " from the template" : ""}.`,
  };
};

type ChaserItem = {
  employer: { code: string; name: string; contactEmail: string | null };
  rows: ArrearsRow[];
};

const draftChasers: FanOut<ChaserItem, { draft: Draft; fallback: boolean }> = {
  items: (_ctx, deps) => {
    const computed = outputOf<ComputeOutput>(deps, "compute");
    const facts = outputOf<PeriodFacts>(deps, "load_period");
    const codes = [...new Set(computed.rows.map((row) => row.code))];
    return codes.map((code) => {
      const employer = facts.employers.find((item) => item.code === code);
      const rows = computed.rows.filter((row) => row.code === code);
      return {
        employer: {
          code,
          name: employer?.name ?? rows[0]?.name ?? code,
          contactEmail: employer?.contactEmail ?? null,
        },
        rows,
      };
    });
  },
  one: async (ctx, item) => {
    const plan = chaserPlan({
      period: period(ctx),
      employer: item.employer,
      rows: item.rows,
    });
    const body = await writeDraftBody({
      plan,
      context: `Employer: ${item.employer.name}. Month: ${formatPeriod(period(ctx))}.\n${item.rows.map((row) => `- ${row.kind}, ${row.daysLate} days`).join("\n")}`,
      stubbed: ctx.stubbed,
    });
    return {
      value: {
        draft: finishDraft(plan, body.value, "draft_chasers"),
        fallback: body.fallback,
      },
      usage: body.usage,
      fallback: body.fallback,
    };
  },
  combine: (_ctx, values) => ({
    output: {
      drafts: values.map((value) => value.draft),
      risk: "low",
      fallback: values.some((value) => value.fallback),
    } satisfies DraftOutput,
    skipped: values.length === 0,
    summary:
      values.length === 0
        ? "No Employer to chase."
        : `Drafted ${values.length} chaser${values.length === 1 ? "" : "s"}.`,
  }),
};

const file: Executor = async (ctx, deps) => {
  const approval = outputOf<ApprovalOutcome>(deps, "approval");
  if (approval.decision !== "approve") {
    return {
      output: { filed: false },
      skipped: true,
      summary: "Nothing filed: the report was not approved.",
    };
  }
  const computed = outputOf<ComputeOutput>(deps, "compute");
  const reportable = [
    ...new Set(
      computed.rows
        .filter((row) => row.reportable)
        .map((row) => row.employerId),
    ),
  ];
  if (reportable.length > 0) {
    const db = sql();
    await db`
      update harness.employers set status = 'delinquent'
      where owner = ${ctx.owner} and id in ${db(reportable)} and status = 'active'`;
  }
  const chasers = deps.draft_chasers
    ? outputOf<DraftOutput>(deps, "draft_chasers").drafts.length
    : 0;
  return {
    output: {
      filed: true,
      filedOn: ctx.asOf,
      reportedEmployers: computed.rows
        .filter((row) => row.reportable)
        .map((row) => row.code),
      chasers,
    },
    summary: `Filed the report for ${formatPeriod(period(ctx))}: ${reportable.length} Employer${reportable.length === 1 ? "" : "s"} marked delinquent, ${chasers} chaser${chasers === 1 ? "" : "s"} ready to send.`,
  };
};

export const DELINQUENCY_RUNNER: PipelineRunner = {
  steps: {
    load_period: loadPeriod,
    find_missing: findStep("find_missing"),
    find_late: findStep("find_late"),
    compute,
    draft_report: draftReport,
    file,
  },
  fanOut: { draft_chasers: draftChasers as FanOut<unknown, unknown> },
  approval: (_ctx, deps: Deps) => {
    const report = outputOf<DraftOutput>(deps, "draft_report").drafts[0];
    if (!report) throw new StepProblem("There is no report to approve.");
    const chasers = deps.draft_chasers
      ? outputOf<DraftOutput>(deps, "draft_chasers").drafts.length
      : 0;
    return {
      kind: report.kind,
      title:
        chasers > 0
          ? `${report.title} and ${chasers} chaser${chasers === 1 ? "" : "s"}`
          : report.title,
      risk: "high",
      draft: report,
    };
  },
  result: (ctx, outputs) => {
    const computed = outputs.compute as ComputeOutput | undefined;
    const filed = outputs.file as { filed?: boolean } | undefined;
    return {
      period: period(ctx),
      employers: computed?.totals.employers ?? null,
      reportableEmployers: computed?.totals.reportableEmployers ?? null,
      arrearsKyd: computed?.totals.arrearsKyd ?? null,
      interestKyd: computed?.totals.interestKyd ?? null,
      reportBy: computed?.reportBy ?? null,
      filed: filed?.filed ?? false,
    };
  },
};
