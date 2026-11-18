import "server-only";
import { LIMITS } from "../../domain/limits";
import { applyChecks, type FindingDraft } from "../../domain/pipelines/apply";
import { MEMBER_REQUEST_CHECKS } from "../../domain/pipelines/checks/member-request";
import { nameDistance } from "../../domain/pipelines/checks/text";
import {
  type DecideResult,
  decideMemberRequest,
} from "../../domain/pipelines/decide";
import {
  DOCUMENT_TYPE_LABEL,
  type DocumentType,
} from "../../domain/pipelines/documents";
import {
  finishDraft,
  memberRequestAmount,
  memberRequestDraftPlan,
} from "../../domain/pipelines/drafts";
import { classifyByKeywords } from "../../domain/pipelines/extract";
import {
  claimedIdentity,
  type DocumentReading,
  type IntakeSource,
  type KindReading,
  kindGivenBy,
  kindSourceText,
  MEMBER_NO,
  type MemberRequestFacts,
  normaliseMemberNo,
  propertyPurposeOf,
  requestedAmount,
  resolveRequestKind,
} from "../../domain/pipelines/member-request";
import {
  MEMBER_REQUEST_KINDS,
  type Member,
  type MemberRequestKind,
  type MemberRequestStatus,
} from "../../domain/records";
import type { Draft } from "../../domain/run";
import { jsonb, sql } from "../db";
import { findMembers, memberByIdOrNo } from "../records";
import type { StepScope } from "./code";
import type { Classification } from "./model";
import { classifyRequest, readPapers, writeDraftBody } from "./model";
import { sourcesOf, sourceText } from "./source-file";
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

type IntakeOutput = {
  sources: IntakeSource[];
  receivedOn: string;
  note: string | null;
};
type ClassifyOutput = Classification & {
  fallback: boolean;
  /** How the kind was read; older Runs saved before it have none. */
  kindReading?: KindReading;
};
type ReadOutput = { readings: DocumentReading[]; fallback: boolean };
type FindOutput = {
  member: Member | null;
  matchedBy: "input" | "number" | "name" | null;
};
type CheckOutput = { findings: FindingDraft[]; notMet: number };
type DecideOutput = DecideResult & {
  kind: MemberRequestKind | null;
  memberNo: string | null;
  memberId: string | null;
  amountKyd: number | null;
  missingPapers: string[];
  /** Where the kind came from, in words; null when unknown. */
  kindSource?: string | null;
};
type DraftOutput = { drafts: Draft[]; risk: "low" | "high"; fallback: boolean };

const PIPELINE = "member_request" as const;

function kindOf(deps: Deps): {
  kind: MemberRequestKind | null;
  kindReading?: KindReading;
} {
  if (!deps.classify) return { kind: null };
  const classified = outputOf<ClassifyOutput>(deps, "classify");
  if (!classified.kindReading) return { kind: classified.kind };
  return {
    kind: resolveRequestKind(classified.kindReading).kind,
    kindReading: classified.kindReading,
  };
}

function facts(ctx: RunContext, deps: Deps): MemberRequestFacts {
  return {
    asOf: ctx.asOf,
    receivedOn: outputOf<IntakeOutput>(deps, "intake").receivedOn,
    ...kindOf(deps),
    member: deps.find_member
      ? outputOf<FindOutput>(deps, "find_member").member
      : null,
    readings: deps.read_documents
      ? outputOf<ReadOutput>(deps, "read_documents").readings
      : [],
  };
}

function check(stepId: keyof typeof MEMBER_REQUEST_CHECKS): Executor {
  return async (ctx, deps) => {
    const findings = applyChecks({
      pipelineId: PIPELINE,
      stepId,
      checks: MEMBER_REQUEST_CHECKS[stepId],
      facts: facts(ctx, deps),
      states: ctx.states,
      asOf: ctx.asOf,
    });
    const notMet = findings.filter((finding) => !finding.met).length;
    return {
      output: { findings, notMet } satisfies CheckOutput,
      findings,
      skipped: findings.length === 0,
      summary:
        findings.length === 0
          ? "No Rule applies to this request here."
          : `${findings.length} Rule${findings.length === 1 ? "" : "s"} checked, ${notMet} not met.`,
    };
  };
}

const intake: Executor = async (ctx) => {
  const ids = (ctx.input.sourceIds as string[]).slice(0, LIMITS.sourcesPerRun);
  const metas = await sourcesOf(ctx.owner, ids);
  if (metas.length === 0)
    throw new StepProblem("None of the attached papers are in this Workspace.");
  const sources: IntakeSource[] = [];
  for (const meta of metas) {
    const text = await sourceText(ctx.owner, meta);
    sources.push({
      id: meta.id,
      title: meta.title,
      kind: meta.kind,
      addedOn: meta.addedOn,
      text: text.slice(0, LIMITS.sourceCharsPerStep),
      chars: text.length,
    });
  }
  const unreadable = sources.filter((source) => !source.text.trim());
  if (unreadable.length === sources.length) {
    throw new StepProblem(
      "None of the papers could be read as text yet. Wait until they show as read in the Knowledge base, then start the Run again.",
    );
  }
  const receivedOn =
    sources.map((source) => source.addedOn).sort()[0] ?? ctx.asOf;
  return {
    output: {
      sources,
      receivedOn,
      note: typeof ctx.input.note === "string" ? ctx.input.note : null,
    } satisfies IntakeOutput,
    summary: `${sources.length} paper${sources.length === 1 ? "" : "s"} loaded; received ${receivedOn}.`,
  };
};

/** Lets a reading Step code in a Sandbox of its own (ADR 0022). */
const codeScope = (ctx: RunContext, stepId: string): StepScope => ({
  owner: ctx.owner,
  runId: ctx.runId,
  sessionId: ctx.sessionId,
  stepId,
});

const classify: Executor = async (ctx, deps) => {
  const { sources } = outputOf<IntakeOutput>(deps, "intake");
  const keywords = classifyByKeywords(
    sources.map((source) => `## ${source.title}\n${source.text}`).join("\n\n"),
  ).kind;
  const given = MEMBER_REQUEST_KINDS.find((kind) => kind === ctx.input.kind);
  if (given) {
    // A kind in the input spends no model call. Whether it stands on its own
    // depends on who gave it: a person or the guide, yes; the Agent (chat or
    // MCP), only when the papers' own wording names the same kind.
    const kindReading: KindReading = {
      given,
      givenBy: kindGivenBy(ctx.startedVia),
      model: null,
      modelFailed: false,
      keywords,
    };
    const resolved = resolveRequestKind(kindReading);
    return {
      output: {
        kind: given,
        confidence: 1,
        reason: `Stated in the Run's input (${kindSourceText(kindReading)}).`,
        fallback: false,
        kindReading,
      } satisfies ClassifyOutput,
      summary: `Kind ${given}: ${kindSourceText(kindReading)}${!resolved.needsConfirmation && keywords && keywords !== given ? ` (the papers' wording reads ${keywords})` : ""}.`,
    };
  }
  const result = await classifyRequest({
    texts: sources.map((source) => ({
      title: source.title,
      text: source.text,
    })),
    stubbed: ctx.stubbed,
    code: codeScope(ctx, "classify"),
  });
  const kindReading: KindReading = {
    given: null,
    model: result.value.kind,
    // A stubbed Run (e2e) means no model by design; only a failed call counts.
    modelFailed: result.fallback && !ctx.stubbed,
    keywords,
  };
  const resolved = resolveRequestKind(kindReading);
  return {
    output: {
      ...result.value,
      kind: resolved.kind,
      fallback: result.fallback,
      kindReading,
    } satisfies ClassifyOutput,
    usage: result.usage,
    summary: resolved.kind
      ? `Classified as ${resolved.kind}${result.fallback ? " (by keywords)" : ""}${resolved.needsConfirmation ? "; a person must confirm the kind" : ""}.`
      : "Could not tell which kind of request it is.",
  };
};

const readDocuments: FanOut<IntakeSource, DocumentReading> = {
  items: (_ctx, deps) => outputOf<IntakeOutput>(deps, "intake").sources,
  one: async (ctx, source) => {
    const result = await readPapers({
      source: { id: source.id, title: source.title, text: source.text },
      stubbed: ctx.stubbed,
      code: codeScope(ctx, "read_documents"),
    });
    return {
      value: result.value,
      usage: result.usage,
      fallback: result.fallback,
    };
  },
  combine: (_ctx, readings) => {
    const papers = readings.flatMap((reading) => reading.papers);
    return {
      output: {
        readings,
        fallback: readings.some((reading) => reading.fallback),
      } satisfies ReadOutput,
      summary: `${papers.length} paper${papers.length === 1 ? "" : "s"} found in ${readings.length} Source${readings.length === 1 ? "" : "s"}.`,
    };
  },
};

const NAME_LINE =
  /^\s*(?:member(?:'s)? (?:full )?name|name of member|full name)\s*:\s*(.+)$/im;

const findMember: Executor = async (ctx, deps) => {
  const { sources } = outputOf<IntakeOutput>(deps, "intake");
  const db = sql();
  const given =
    typeof ctx.input.memberNo === "string" ? ctx.input.memberNo : null;
  if (given) {
    const member = await memberByIdOrNo(db, ctx.owner, given);
    return {
      output: {
        member,
        matchedBy: member ? "input" : null,
      } satisfies FindOutput,
      summary: member
        ? `Found ${member.fullName} (${member.memberNo}).`
        : `No Member ${given}.`,
    };
  }
  const text = sources.map((source) => source.text).join("\n");
  const number = MEMBER_NO.exec(text)?.[0];
  if (number) {
    const member = await memberByIdOrNo(
      db,
      ctx.owner,
      normaliseMemberNo(number),
    );
    if (member) {
      return {
        output: { member, matchedBy: "number" } satisfies FindOutput,
        summary: `Found ${member.fullName} by member number ${member.memberNo}.`,
      };
    }
  }
  const name = NAME_LINE.exec(text)?.[1]?.trim();
  if (name) {
    const surname = name.split(/\s+/).at(-1) ?? name;
    const candidates = await findMembers(ctx.owner, { q: surname, limit: 20 });
    const close = candidates
      .map((member) => ({
        member,
        distance: nameDistance(name, member.fullName),
      }))
      .filter((item) => item.distance <= 2)
      .sort((a, b) => a.distance - b.distance);
    // Only an unambiguous name match counts.
    if (
      close.length === 1 ||
      (close[0] && close[1] && close[0].distance < close[1].distance)
    ) {
      const member = close[0]?.member ?? null;
      return {
        output: { member, matchedBy: "name" } satisfies FindOutput,
        summary: member
          ? `Found ${member.fullName} by name.`
          : "No Member matched.",
      };
    }
  }
  return {
    output: { member: null, matchedBy: null } satisfies FindOutput,
    summary: "No Member record matches the papers.",
  };
};

const decide: Executor = async (ctx, deps) => {
  const all = [
    "check_identity",
    "check_eligibility",
    "check_documents",
    "check_deadline",
  ].flatMap((stepId) =>
    deps[stepId] ? outputOf<CheckOutput>(deps, stepId).findings : [],
  );
  const current = facts(ctx, deps);
  const result = decideMemberRequest({
    findings: all,
    kind: current.kind,
    memberFound: current.member !== null,
  });
  const missing = all
    .filter(
      (finding) => !finding.met && Array.isArray(finding.compared.missing),
    )
    .flatMap((finding) => finding.compared.missing as string[])
    .map((type) => DOCUMENT_TYPE_LABEL[type as DocumentType] ?? type);
  const output: DecideOutput = {
    ...result,
    kind: current.kind,
    memberNo: current.member?.memberNo ?? null,
    memberId: current.member?.id ?? null,
    amountKyd:
      result.decision === "proceed"
        ? memberRequestAmount({
            kind: current.kind,
            member: current.member,
            requestedAmountKyd: requestedAmount(current.readings),
          })
        : null,
    missingPapers: missing,
    kindSource: current.kindReading
      ? kindSourceText(current.kindReading)
      : null,
  };
  return {
    output,
    summary: `Decided: ${result.decision.replace("_", " ")} (${result.blocking.length} block, ${result.referred.length} refer, ${result.warnings.length} warn).`,
  };
};

function draftInputOf(ctx: RunContext, deps: Deps) {
  const decided = outputOf<DecideOutput>(deps, "decide");
  const current = facts(ctx, deps);
  return {
    decide: decided,
    kind: decided.kind,
    member: current.member,
    claimedName: claimedIdentity(current.readings).fullName,
    requestedAmountKyd: requestedAmount(current.readings),
    receivingPlan:
      current.readings.find((reading) => reading.receivingPlan)
        ?.receivingPlan ?? null,
    missingPapers: decided.missingPapers,
    note: outputOf<IntakeOutput>(deps, "intake").note,
    asOf: ctx.asOf,
    receivedOn: current.receivedOn,
    kindSource: current.kindReading
      ? kindSourceText(current.kindReading)
      : null,
  };
}

const draft: Executor = async (ctx, deps) => {
  const input = draftInputOf(ctx, deps);
  const plan = memberRequestDraftPlan(input);
  const context = [
    `Decision (made by code): ${input.decide.decision}.`,
    input.kind
      ? `Request: ${input.kind}${input.kindSource ? ` (${input.kindSource})` : ""}.`
      : "Request kind unclear.",
    input.member
      ? `Member: ${input.member.fullName}, status ${input.member.status}.`
      : "No Member record found.",
    propertyPurposeOf(facts(ctx, deps).readings)
      ? `Property purpose: ${propertyPurposeOf(facts(ctx, deps).readings)}.`
      : "",
    input.note ? `Note from the Staff member: ${input.note}` : "",
    "Reasons:",
    ...input.decide.reasons.map((reason) => `- ${reason}`),
  ]
    .filter(Boolean)
    .join("\n");
  const body = await writeDraftBody({ plan, context, stubbed: ctx.stubbed });
  const written = finishDraft(plan, body.value, "draft");
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

const STATUS_AFTER: Record<DecideResult["decision"], MemberRequestStatus> = {
  proceed: "approved",
  reject: "closed",
  request_documents: "in_review",
};

const record: Executor = async (ctx, deps) => {
  const approval = outputOf<ApprovalOutcome>(deps, "approval");
  const decided = outputOf<DecideOutput>(deps, "decide");
  if (approval.decision !== "approve") {
    return {
      output: { recorded: false },
      skipped: true,
      summary: "Nothing recorded: the Draft was not approved.",
    };
  }
  if (!decided.memberId || !decided.kind) {
    return {
      output: {
        recorded: false,
        reason: "No Member record or kind to record against.",
      },
      skipped: true,
      summary: "Nothing recorded: no Member record or kind.",
    };
  }
  const db = sql();
  const status = STATUS_AFTER[decided.decision];
  const details = {
    decision: decided.decision,
    blocking: decided.blocking,
    referred: decided.referred,
    warnings: decided.warnings,
    missingPapers: decided.missingPapers,
    kindSource: decided.kindSource,
    approvedBy: approval.decidedBy?.name ?? null,
  };
  const receivedOn = outputOf<IntakeOutput>(deps, "intake").receivedOn;
  // One request per Run: a retried Step updates the row it wrote.
  const [existing] = await db<{ id: string }[]>`
    select id from harness.member_requests where owner = ${ctx.owner} and run_id = ${ctx.runId}`;
  const [row] = existing
    ? await db<{ id: string }[]>`
        update harness.member_requests
        set status = ${status}, amount_kyd = ${decided.amountKyd}, details = ${jsonb(db, details)}
        where owner = ${ctx.owner} and id = ${existing.id}
        returning id`
    : await db<{ id: string }[]>`
        insert into harness.member_requests (owner, member_id, kind, received_on, status, amount_kyd, details, run_id)
        select ${ctx.owner}, m.id, ${decided.kind}, ${receivedOn}, ${status}, ${decided.amountKyd},
               ${jsonb(db, details)}, ${ctx.runId}
        from harness.members m
        where m.owner = ${ctx.owner} and m.id = ${decided.memberId}
        returning id`;
  if (!row)
    throw new StepProblem("The Member record is no longer in this Workspace.");
  return {
    output: { recorded: true, requestId: row.id, status },
    summary: `Recorded the ${decided.kind.replace(/_/g, " ")} request as ${status.replace("_", " ")}.`,
  };
};

export const MEMBER_REQUEST_RUNNER: PipelineRunner = {
  steps: {
    intake,
    classify,
    find_member: findMember,
    check_identity: check("check_identity"),
    check_eligibility: check("check_eligibility"),
    check_documents: check("check_documents"),
    check_deadline: check("check_deadline"),
    decide,
    draft,
    record,
  },
  fanOut: { read_documents: readDocuments as FanOut<unknown, unknown> },
  approval: (_ctx, deps) => {
    const written = outputOf<DraftOutput>(deps, "draft");
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
    const decided = outputs.decide as DecideOutput | undefined;
    const recorded = outputs.record as
      | { requestId?: string; status?: string }
      | undefined;
    const approval = outputs.approval as ApprovalOutcome | undefined;
    return {
      kind: decided?.kind ?? null,
      memberNo: decided?.memberNo ?? null,
      decision: decided?.decision ?? null,
      amountKyd: decided?.amountKyd ?? null,
      approval: approval?.decision ?? null,
      requestId: recorded?.requestId ?? null,
      requestStatus: recorded?.status ?? null,
    };
  },
};
