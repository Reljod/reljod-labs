import "server-only";
import {
  applyChecks,
  type FindingDraft,
  paramOf,
} from "../../domain/pipelines/apply";
import { CONTRIBUTION_CHECKS } from "../../domain/pipelines/checks/contribution";
import type {
  RemittanceIn,
  ScheduleMember,
} from "../../domain/pipelines/contribution-processing";
import {
  addPeriods,
  formatPeriod,
  isPeriod,
  periodOf,
  periodStart,
} from "../../domain/pipelines/dates";
import {
  contributionDraftPlan,
  finishDraft,
} from "../../domain/pipelines/drafts";
import {
  type Reconciliation,
  reconcile,
} from "../../domain/pipelines/reconcile";
import {
  EMPLOYER_CODE,
  type ParsedSchedule,
  parseSchedule,
  type ScheduleLineIn,
  scheduleTotal,
} from "../../domain/pipelines/schedule";
import type { Draft } from "../../domain/run";
import { sql } from "../db";
import { employerByIdOrCode } from "../records";
import { writeDraftBody } from "./model";
import { bytesAsText, sourceBytes, sourcesOf, sourceText } from "./source-file";
import {
  type ApprovalOutcome,
  type Deps,
  type Executor,
  outputOf,
  type PipelineRunner,
  type RunContext,
  StepProblem,
} from "./types";

const PIPELINE = "contribution_processing" as const;

type ParseOutput = {
  sourceId: string;
  sourceTitle: string;
  employer: {
    id: string;
    code: string;
    name: string;
    contactEmail: string | null;
  };
  period: string;
  lines: ScheduleLineIn[];
  problems: string[];
  totalKyd: number;
};
type CheckOutput = { findings: FindingDraft[]; notMet: number };
type ReconcileOutput = Reconciliation & { override: boolean };
type DraftOutput = { drafts: Draft[]; risk: "low" | "high"; fallback: boolean };

const parsed = (deps: Deps) => outputOf<ParseOutput>(deps, "parse_schedule");

const parseScheduleStep: Executor = async (ctx) => {
  const sourceId = ctx.input.sourceId as string;
  const [source] = await sourcesOf(ctx.owner, [sourceId]);
  if (!source) throw new StepProblem("That Schedule is not in this Workspace.");
  // The file itself when there is one: a Passage split would lose the columns.
  const bytes = await sourceBytes(source);
  const text = bytes
    ? bytesAsText(bytes, source.storagePath, source.kind)
    : await sourceText(ctx.owner, source);
  if (!text?.trim()) {
    throw new StepProblem(
      `"${source.title}" could not be read as a CSV or XLSX Schedule.`,
    );
  }
  const schedule: ParsedSchedule = parseSchedule(text);
  const code =
    (typeof ctx.input.employerCode === "string"
      ? ctx.input.employerCode
      : null) ??
    schedule.employerCode ??
    EMPLOYER_CODE.exec(source.title)?.[0]?.toUpperCase() ??
    null;
  if (!code) {
    throw new StepProblem(
      "The Schedule does not say which Employer it is for. Start the Run again with the Employer's code (ER-1001).",
    );
  }
  const employer = await employerByIdOrCode(sql(), ctx.owner, code);
  if (!employer) throw new StepProblem(`No Employer ${code} is in the plan.`);
  const period =
    (typeof ctx.input.period === "string" && isPeriod(ctx.input.period)
      ? ctx.input.period
      : null) ??
    schedule.period ??
    addPeriods(periodOf(ctx.asOf), -1);
  if (schedule.lines.length === 0) {
    throw new StepProblem(schedule.problems[0] ?? "The Schedule has no lines.");
  }
  const output: ParseOutput = {
    sourceId: source.id,
    sourceTitle: source.title,
    employer: {
      id: employer.id,
      code: employer.code,
      name: employer.name,
      contactEmail: employer.contactEmail,
    },
    period,
    lines: schedule.lines,
    problems: schedule.problems,
    totalKyd: scheduleTotal(schedule.lines),
  };
  return {
    output,
    summary: `Read ${schedule.lines.length} lines for ${employer.name}, ${formatPeriod(period)}${schedule.problems.length ? `; ${schedule.problems.length} could not be read` : ""}.`,
  };
};

async function scheduleMembers(ctx: RunContext, lines: ScheduleLineIn[]) {
  const numbers = [...new Set(lines.map((line) => line.memberNo))];
  if (numbers.length === 0) return {};
  const db = sql();
  const rows = await db<
    {
      member_no: string;
      full_name: string;
      employer_id: string | null;
      status: ScheduleMember["status"];
      employment_ended_on: string | null;
      date_of_birth: string | null;
      caymanian: boolean;
      residency_status: string | null;
      started_work_on: string | null;
    }[]
  >`
    select member_no, full_name, employer_id, status,
           employment_ended_on::text as employment_ended_on,
           date_of_birth::text as date_of_birth, caymanian, residency_status,
           started_work_on::text as started_work_on
    from harness.members
    where owner = ${ctx.owner} and upper(member_no) in ${db(numbers.map((no) => no.toUpperCase()))}`;
  const members: Record<string, ScheduleMember> = {};
  for (const row of rows) {
    members[row.member_no.toUpperCase()] = {
      memberNo: row.member_no,
      fullName: row.full_name,
      employerId: row.employer_id,
      status: row.status,
      employmentEndedOn: row.employment_ended_on,
      dateOfBirth: row.date_of_birth,
      caymanian: row.caymanian,
      residencyStatus: row.residency_status,
      startedWorkOn: row.started_work_on,
    };
  }
  return members;
}

function checked(stepId: string, findings: FindingDraft[]) {
  const notMet = findings.filter((finding) => !finding.met).length;
  return {
    output: { findings, notMet } satisfies CheckOutput,
    findings,
    skipped: findings.length === 0,
    summary:
      findings.length === 0
        ? "Every Rule here is switched off."
        : `${stepId.replace(/_/g, " ")}: ${findings.length} Rule${findings.length === 1 ? "" : "s"} checked, ${notMet} not met.`,
  };
}

const matchMembers: Executor = async (ctx, deps) => {
  const schedule = parsed(deps);
  const members = await scheduleMembers(ctx, schedule.lines);
  return checked(
    "match_members",
    applyChecks({
      pipelineId: PIPELINE,
      stepId: "match_members",
      checks: CONTRIBUTION_CHECKS.match_members,
      facts: {
        period: schedule.period,
        employerId: schedule.employer.id,
        lines: schedule.lines,
        members,
      },
      states: ctx.states,
      asOf: ctx.asOf,
    }),
  );
};

const annualCap = (ctx: RunContext) =>
  Number(paramOf(ctx.states, "cp.ympe-cap", "annualCap") ?? 87_000);

const checkRates: Executor = async (ctx, deps) =>
  checked(
    "check_rates",
    applyChecks({
      pipelineId: PIPELINE,
      stepId: "check_rates",
      checks: CONTRIBUTION_CHECKS.check_rates,
      facts: { lines: parsed(deps).lines, annualCapKyd: annualCap(ctx) },
      states: ctx.states,
      asOf: ctx.asOf,
    }),
  );

const checkCap: Executor = async (ctx, deps) =>
  checked(
    "check_cap",
    applyChecks({
      pipelineId: PIPELINE,
      stepId: "check_cap",
      checks: CONTRIBUTION_CHECKS.check_cap,
      facts: {
        lines: parsed(deps).lines,
        totalRatePct: Number(
          paramOf(ctx.states, "cp.total-rate", "totalRate") ?? 10,
        ),
      },
      states: ctx.states,
      asOf: ctx.asOf,
    }),
  );

const checkCoverage: Executor = async (ctx, deps) => {
  const schedule = parsed(deps);
  const members = await scheduleMembers(ctx, schedule.lines);
  return checked(
    "check_coverage",
    applyChecks({
      pipelineId: PIPELINE,
      stepId: "check_coverage",
      checks: CONTRIBUTION_CHECKS.check_coverage,
      facts: { period: schedule.period, lines: schedule.lines, members },
      states: ctx.states,
      asOf: ctx.asOf,
    }),
  );
};

async function remittancesFor(
  ctx: RunContext,
  employerId: string,
  period: string,
) {
  const rows = await sql()<
    { amount_kyd: string; received_on: string; reference: string | null }[]
  >`
    select amount_kyd, received_on::text as received_on, reference
    from harness.remittances
    where owner = ${ctx.owner} and employer_id = ${employerId} and period = ${periodStart(period)}
    order by received_on`;
  return rows.map(
    (row): RemittanceIn => ({
      amountKyd: Number(row.amount_kyd),
      receivedOn: row.received_on,
      reference: row.reference,
    }),
  );
}

const matchRemittance: Executor = async (ctx, deps) => {
  const schedule = parsed(deps);
  const remittances = await remittancesFor(
    ctx,
    schedule.employer.id,
    schedule.period,
  );
  const result = checked(
    "match_remittance",
    applyChecks({
      pipelineId: PIPELINE,
      stepId: "match_remittance",
      checks: CONTRIBUTION_CHECKS.match_remittance,
      facts: {
        period: schedule.period,
        asOf: ctx.asOf,
        scheduleTotalKyd: schedule.totalKyd,
        remittances,
      },
      states: ctx.states,
      asOf: ctx.asOf,
    }),
  );
  return {
    ...result,
    output: {
      ...result.output,
      receivedKyd: remittances.reduce((sum, item) => sum + item.amountKyd, 0),
      remittances,
    },
  };
};

const CHECK_STEPS = [
  "match_members",
  "check_rates",
  "check_cap",
  "check_coverage",
  "match_remittance",
];

const reconcileStep: Executor = async (ctx, deps) => {
  const schedule = parsed(deps);
  const findings = CHECK_STEPS.flatMap((stepId) =>
    deps[stepId] ? outputOf<CheckOutput>(deps, stepId).findings : [],
  );
  const received =
    (deps.match_remittance as { receivedKyd?: number } | undefined)
      ?.receivedKyd ?? 0;
  const result = reconcile({
    lines: schedule.lines,
    findings,
    receivedKyd: received,
    readProblems: schedule.problems,
  });
  const override =
    ctx.input.overrideExceptions === true && result.decision === "hold";
  return {
    output: { ...result, override } satisfies ReconcileOutput,
    summary:
      result.decision === "post"
        ? `Ready to post: ${result.totals.lines} lines, ${result.warnings.length} note${result.warnings.length === 1 ? "" : "s"}.`
        : `Hold: ${result.exceptions.length} exception${result.exceptions.length === 1 ? "" : "s"}${override ? " (override asked for)" : ""}.`,
  };
};

const draftQuery: Executor = async (ctx, deps) => {
  const schedule = parsed(deps);
  const recon = outputOf<ReconcileOutput>(deps, "reconcile");
  const plan = contributionDraftPlan({
    employer: schedule.employer,
    employerCode: schedule.employer.code,
    period: schedule.period,
    reconciliation: recon,
    override: recon.override,
  });
  const context = [
    `Employer: ${schedule.employer.name} (${schedule.employer.code}). Month: ${formatPeriod(schedule.period)}.`,
    `Decision (made by code): ${recon.decision}${recon.override ? ", posted over the exceptions on a person's instruction" : ""}.`,
    recon.exceptions.length > 0 ? "Exceptions:" : "No exceptions.",
    ...recon.exceptions
      .slice(0, 20)
      .map((row) => `- ${row.memberNo ?? "Schedule"}: ${row.detail}`),
    ...(recon.warnings.length > 0
      ? [
          "Notes:",
          ...recon.warnings
            .slice(0, 10)
            .map((row) => `- ${row.memberNo ?? "Schedule"}: ${row.detail}`),
        ]
      : []),
  ].join("\n");
  const body = await writeDraftBody({ plan, context, stubbed: ctx.stubbed });
  const written = finishDraft(plan, body.value, "draft_query");
  return {
    output: {
      drafts: [written],
      risk: plan.risk,
      fallback: body.fallback,
    } satisfies DraftOutput,
    usage: body.usage,
    summary: `Drafted "${written.title}"${body.fallback ? " from the template" : ""}.`,
  };
};

const post: Executor = async (ctx, deps) => {
  const approval = outputOf<ApprovalOutcome>(deps, "approval");
  if (approval.decision !== "approve") {
    return {
      output: { posted: false },
      skipped: true,
      summary: "Nothing posted: the Draft was not approved.",
    };
  }
  const schedule = parsed(deps);
  const recon = outputOf<ReconcileOutput>(deps, "reconcile");
  const status =
    recon.decision === "post" || recon.override ? "reconciled" : "queried";
  const db = sql();
  const outcome = await db.begin(async (tx) => {
    const [existing] = await tx<
      { id: string; status: string; source_id: string | null }[]
    >`
      select id, status, source_id from harness.schedules
      where owner = ${ctx.owner} and employer_id = ${schedule.employer.id}
        and period = ${periodStart(schedule.period)}
      for update`;
    if (
      existing?.status === "reconciled" &&
      existing.source_id !== schedule.sourceId
    ) {
      return { scheduleId: existing.id, replaced: false, alreadyPosted: true };
    }
    const [row] = existing
      ? await tx<{ id: string }[]>`
          update harness.schedules
          set source_id = ${schedule.sourceId}, status = ${status}, received_on = ${ctx.asOf}
          where id = ${existing.id} and owner = ${ctx.owner}
          returning id`
      : await tx<{ id: string }[]>`
          insert into harness.schedules (owner, employer_id, period, source_id, received_on, status)
          values (${ctx.owner}, ${schedule.employer.id}, ${periodStart(schedule.period)},
                  ${schedule.sourceId}, ${ctx.asOf}, ${status})
          returning id`;
    if (!row) throw new StepProblem("The Schedule could not be saved.");
    await tx`delete from harness.schedule_lines where owner = ${ctx.owner} and schedule_id = ${row.id}`;
    await tx`
      insert into harness.schedule_lines ${tx(
        schedule.lines.map((line) => ({
          schedule_id: row.id,
          owner: ctx.owner,
          member_no: line.memberNo,
          member_name: line.memberName || line.memberNo,
          earnings_kyd: line.earningsKyd,
          employee_kyd: line.employeeKyd,
          employer_kyd: line.employerKyd,
          voluntary_kyd: line.voluntaryKyd,
        })),
      )}`;
    return {
      scheduleId: row.id,
      replaced: Boolean(existing),
      alreadyPosted: false,
    };
  });
  if (outcome.alreadyPosted) {
    return {
      output: { posted: false, ...outcome },
      skipped: true,
      summary: `The ${formatPeriod(schedule.period)} Schedule of ${schedule.employer.name} was already posted from another file; left as it was.`,
    };
  }
  return {
    output: { posted: status === "reconciled", status, ...outcome },
    summary:
      status === "reconciled"
        ? `Posted ${schedule.lines.length} lines for ${schedule.employer.name}, ${formatPeriod(schedule.period)}.`
        : `Held ${schedule.employer.name}'s Schedule for ${formatPeriod(schedule.period)} as queried.`,
  };
};

export const CONTRIBUTION_RUNNER: PipelineRunner = {
  steps: {
    parse_schedule: parseScheduleStep,
    match_members: matchMembers,
    check_rates: checkRates,
    check_cap: checkCap,
    check_coverage: checkCoverage,
    match_remittance: matchRemittance,
    reconcile: reconcileStep,
    draft_query: draftQuery,
    post,
  },
  fanOut: {},
  approval: (_ctx, deps) => {
    const written = outputOf<DraftOutput>(deps, "draft_query");
    const [first] = written.drafts;
    if (!first) throw new StepProblem("There is no Draft to approve.");
    return {
      kind: first.kind,
      title: first.title,
      risk: written.risk,
      draft: first,
    };
  },
  result: (_ctx, outputs) => {
    const schedule = outputs.parse_schedule as ParseOutput | undefined;
    const recon = outputs.reconcile as ReconcileOutput | undefined;
    const posted = outputs.post as
      | { status?: string; scheduleId?: string }
      | undefined;
    return {
      employerCode: schedule?.employer.code ?? null,
      period: schedule?.period ?? null,
      decision: recon?.decision ?? null,
      exceptions: recon?.exceptions.length ?? null,
      totalKyd: recon?.totals.totalKyd ?? null,
      receivedKyd: recon?.totals.receivedKyd ?? null,
      scheduleId: posted?.scheduleId ?? null,
      scheduleStatus: posted?.status ?? null,
    };
  },
};
