import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { unstable_rethrow } from "next/navigation";
import { ZodError, z } from "zod";
import {
  ACTOR_KINDS,
  AUDIT_ACTION_IDS,
  type AuditActor,
} from "../domain/audit";
import { cutArgs, type ToolCards } from "../domain/chat-turn";
import {
  GUEST_TOKEN_HEADER,
  HARNESS_PROTECTED_RESOURCE_PATH,
  MCP_SERVER_NAME,
  type McpToolSpec,
  pipelineTool,
  runLink,
  STATIC_MCP_TOOLS,
  type StaticToolName,
  toolAllowed,
} from "../domain/mcp-tools";
import { guestTokenProblem, type HarnessClaims } from "../domain/oauth";
import { levels, PIPELINE_IDS } from "../domain/pipeline";
import { PIPELINES } from "../domain/pipelines";
import { pipelineInputSchema } from "../domain/pipelines/tool-schema";
import {
  MEMBER_REQUEST_KINDS,
  type MemberRequestStatus,
} from "../domain/records";
import { ruleSentenceText } from "../domain/rules";
import type { RunView } from "../domain/run";
import { sandboxNote } from "../domain/sandbox";
import { renderSkillMd } from "../domain/skills";
import { audit, listAudit } from "./audit";
import { env } from "./env";
import {
  ForbiddenError,
  InvalidError,
  LimitError,
  NotBuiltError,
  NotFoundError,
  StateError,
} from "./errors";
import {
  addTextSource,
  ingestSource,
  listConflicts,
  listSources,
  readSource,
  readSourceText,
  searchKnowledge,
} from "./knowledge";
import { actorOf, type McpActor, verifyBearer } from "./mcp-auth";
import {
  findMembers,
  getEmployer,
  getMember,
  listEmployers,
  listMemberRequests,
  listSchedules,
} from "./records";
import { listRules } from "./rules";
import { getRun, listRuns, startRun, stopRun } from "./runs";
import {
  sandboxListFiles,
  sandboxReadFile,
  sandboxRun,
  sandboxWriteFile,
} from "./sandbox";
import { writableSession } from "./sessions";
import { getSkill, listSkills } from "./skills";

/*
 * The Harness MCP server (ADR 0013): the only way in, for the built-in chat
 * and for Claude alike. Every request carries a Harness token; every tool
 * checks the Staff member's Role, scopes to the Owner and writes an Audit
 * event. No tool gives an Approval or settles a Conflict: a person does that
 * in the app.
 */

// Answers ------------------------------------------------------------------------------

/** What a tool hands back: a lead line for the model, the data, and any cards for the chat. */
type Outcome = {
  lead: string;
  data?: unknown;
  cards?: ToolCards;
};

const TEXT_CHARS = 30_000;

function answer(outcome: Outcome) {
  const body =
    outcome.data === undefined ? "" : `\n${JSON.stringify(outcome.data)}`;
  const text = `${outcome.lead}${body}`;
  return {
    content: [
      {
        type: "text" as const,
        text:
          text.length > TEXT_CHARS
            ? `${text.slice(0, TEXT_CHARS)}… (cut; ask for less)`
            : text,
      },
    ],
    structuredContent: {
      ...(outcome.data && typeof outcome.data === "object"
        ? Array.isArray(outcome.data)
          ? { items: outcome.data }
          : (outcome.data as Record<string, unknown>)
        : {}),
      ...(outcome.cards ? { cards: outcome.cards } : {}),
    } as Record<string, unknown>,
  };
}

const KNOWN = [
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
  StateError,
] as const;

/** What the model is told when a tool fails: the reason when it is one a person can act on. */
function refusalOf(error: unknown, spec: McpToolSpec): string {
  if (spec.group === "sandbox" && error instanceof NotBuiltError)
    return "Sandbox offline.";
  if (error instanceof NotBuiltError) return error.message;
  if (KNOWN.some((kind) => error instanceof kind))
    return (error as Error).message;
  if (error instanceof ZodError)
    return error.issues[0]?.message ?? "Those arguments don't look right.";
  return "That failed on the server. Try again, or another tool.";
}

function failed(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

class ToolRefusal extends InvalidError {}

// Who is calling -----------------------------------------------------------------------

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

type Caller = McpActor & { origin: string };

function callerOf(ctx: unknown): Caller {
  const extra = (ctx as ToolContext).http?.authInfo?.extra;
  const actor = extra?.actor as McpActor | undefined;
  if (!actor) throw new ForbiddenError("Not signed in to the Harness.");
  return { ...actor, origin: String(extra?.origin ?? "") };
}

/** The chat's tokens act as the Agent; anyone else's as the Staff member. */
function auditActorOf(caller: Caller): AuditActor {
  return caller.claims.via === "chat"
    ? { kind: "agent" }
    : { kind: "staff", staff: caller.staff };
}

/**
 * Runs one tool for the caller: the Role check, the work, and a `tool.called`
 * or `tool.failed` Audit event. Any error becomes a clean tool error.
 */
function handle<I>(
  spec: McpToolSpec,
  work: (input: I, caller: Caller) => Promise<Outcome>,
) {
  return async (input: I, ctx: unknown) => {
    let caller: Caller;
    try {
      caller = callerOf(ctx);
    } catch (error) {
      return failed(refusalOf(error, spec));
    }
    const record = (ok: boolean, extra: Record<string, unknown> = {}) =>
      audit({
        owner: caller.owner,
        sessionId: caller.claims.sessionId ?? null,
        actor: auditActorOf(caller),
        action: ok ? "tool.called" : "tool.failed",
        summary: `${ok ? "Called" : "Failed"} ${spec.name}`,
        target: { kind: "tool", id: spec.name },
        detail: {
          tool: spec.name,
          via: caller.claims.via,
          staff: { id: caller.staff.id, name: caller.staff.name },
          args: cutArgs(input),
          ...extra,
        },
      });
    try {
      if (spec.permission && !toolAllowed(caller.staff, spec)) {
        throw ForbiddenError.forAction(spec.permission);
      }
      const outcome = await work(input, caller);
      await record(true);
      return answer(outcome);
    } catch (error) {
      unstable_rethrow(error);
      const message = refusalOf(error, spec);
      if (message.startsWith("That failed on the server"))
        console.error("[harness] mcp tool", spec.name, error);
      await record(false, { error: message }).catch(() => null);
      return failed(message);
    }
  };
}

const absolute = (caller: Caller, path: string) =>
  caller.origin ? `${caller.origin}${path}` : path;

// Pipelines ------------------------------------------------------------------------------

/** A Run as the model reads it: what happened, and what waits for a person. */
function runBrief(run: RunView, caller: Caller) {
  const pending = run.approvals.filter(
    (approval) => approval.status === "pending",
  );
  return {
    runId: run.id,
    pipelineId: run.pipelineId,
    subject: run.subject,
    status: run.status,
    startedBy: run.startedBy.name,
    link: absolute(caller, runLink(run.id)),
    error: run.error,
    steps: run.steps.map((step) => ({
      step: step.stepId,
      status: step.status,
      ...(step.error ? { error: step.error } : {}),
    })),
    findings: run.findings.map((finding) => ({
      rule: finding.ruleId,
      version: finding.ruleVersion,
      met: finding.met,
      outcome: finding.outcome,
      summary: finding.summary,
    })),
    drafts: run.drafts.map((draft) => ({
      kind: draft.kind,
      title: draft.title,
      to: draft.to,
      body:
        draft.body.length > 2_000
          ? `${draft.body.slice(0, 2_000)}…`
          : draft.body,
    })),
    approvals: run.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      risk: approval.risk,
      status: approval.status,
      decidedBy: approval.decidedBy?.name ?? null,
      note: approval.note,
    })),
    ...(pending.length > 0
      ? {
          waitingFor: pending.map((approval) =>
            approval.risk === "high"
              ? `"${approval.title}" needs an admin who did not start the Run.`
              : `"${approval.title}" needs any Staff member.`,
          ),
          note: "A person must decide pending Approvals in the app, at the link. You cannot approve.",
        }
      : {}),
  };
}

function registerPipelineTools(server: McpServer) {
  for (const spec of PIPELINES) {
    const tool = pipelineTool(spec);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: pipelineInputSchema(spec),
      },
      handle(tool, async (input: Record<string, unknown>, caller) => {
        const run = await startRun({
          owner: caller.owner,
          staff: caller.staff,
          visitor: caller.visitor,
          sessionId: caller.claims.sessionId ?? null,
          pipelineId: spec.id,
          input,
          via: caller.claims.via === "chat" ? "chat" : "mcp",
        });
        const link = absolute(caller, runLink(run.id));
        return {
          lead: `Started a Run of ${spec.title} (${run.subject}). It carries on in the app: ${link}`,
          data: {
            runId: run.id,
            pipelineId: run.pipelineId,
            status: run.status,
            subject: run.subject,
            link,
          },
          cards: { run: { runId: run.id, pipelineId: run.pipelineId } },
        };
      }),
    );
  }
}

// The rest -----------------------------------------------------------------------------------

const id = z.string().min(1).max(120);
const limit = (max: number) =>
  z.number().int().min(1).max(max).optional().describe(`At most ${max}`);
const sessionArg = z
  .string()
  .optional()
  .describe(
    "The Session whose Sandbox to use. Needed outside the built-in chat; must be a Session of the Staff member you act as.",
  );

/** The Session a Sandbox tool works in: the chat's own, or one the Staff member owns. */
async function sandboxSession(
  caller: Caller,
  given: string | undefined,
): Promise<string> {
  if (caller.claims.via === "chat" && caller.claims.sessionId)
    return caller.claims.sessionId;
  if (!given)
    throw new ToolRefusal(
      "Give sessionId: a Session of the Staff member you act as (open one in the app).",
    );
  const session = await writableSession(caller, given);
  return session.id;
}

type Work<I> = (input: I, caller: Caller) => Promise<Outcome>;

type Registration<I = never> = {
  input: z.ZodObject;
  work: Work<I>;
};

const reg = <S extends z.ZodObject>(
  input: S,
  work: Work<z.infer<S>>,
): Registration<z.infer<S>> => ({ input, work });

const noInput = z.object({});

/** Each tool's input and work, keyed by its name in `STATIC_MCP_TOOLS`. */
// biome-ignore lint/suspicious/noExplicitAny: the registry holds every tool's own input type.
const TOOLS: Record<StaticToolName, Registration<any>> = {
  list_pipelines: reg(noInput, async () => ({
    lead: `${PIPELINES.length} Pipelines.`,
    data: PIPELINES.map((spec) => ({
      id: spec.id,
      tool: pipelineTool(spec).name,
      title: spec.title,
      summary: spec.summary,
      input: spec.inputSchema,
      levels: levels(spec).map((level) =>
        level.map((step) => ({
          id: step.id,
          title: step.title,
          kind: step.kind,
          ...(step.risk ? { approvalRisk: step.risk } : {}),
        })),
      ),
    })),
  })),

  get_run: reg(z.object({ runId: id }), async (input, caller) => {
    const run = await getRun(caller.owner, input.runId);
    if (!run) throw new NotFoundError("That Run is not in this Workspace.");
    const brief = runBrief(run, caller);
    return {
      lead: `${run.subject}: ${run.status}.${brief.waitingFor ? ` Waiting for a person: ${brief.waitingFor.join(" ")}` : ""}`,
      data: brief,
    };
  }),

  list_runs: reg(
    z.object({ sessionId: z.string().optional(), limit: limit(50) }),
    async (input, caller) => {
      const runs = await listRuns(caller.owner, {
        sessionId: input.sessionId ?? null,
        limit: input.limit ?? 20,
      });
      return {
        lead: `${runs.length} Runs.`,
        data: runs.map((run) => ({
          runId: run.id,
          pipelineId: run.pipelineId,
          subject: run.subject,
          status: run.status,
          startedBy: run.startedBy.name,
          createdAt: run.createdAt,
          link: absolute(caller, runLink(run.id)),
        })),
      };
    },
  ),

  stop_run: reg(z.object({ runId: id }), async (input, caller) => {
    const run = await stopRun({
      owner: caller.owner,
      staff: caller.staff,
      runId: input.runId,
    });
    return {
      lead: `The Run is ${run.status}.`,
      data: { runId: run.id, status: run.status },
    };
  }),

  find_members: reg(
    z.object({
      query: z.string().max(120).optional().describe("A name or member number"),
      employerId: z.string().optional(),
      limit: limit(50),
    }),
    async (input, caller) => {
      const members = await findMembers(caller.owner, {
        q: input.query ?? "",
        employerId: input.employerId ?? null,
        limit: input.limit ?? 20,
      });
      return { lead: `${members.length} Members.`, data: members };
    },
  ),

  get_member: reg(
    z.object({ member: id.describe("A Member's id or member number") }),
    async (input, caller) => {
      const found = await getMember(caller.owner, input.member);
      if (!found) throw new NotFoundError("No such Member in this Workspace.");
      return {
        lead: `${found.member.fullName} (${found.member.memberNo}).`,
        data: found,
      };
    },
  ),

  list_employers: reg(noInput, async (_input, caller) => {
    const employers = await listEmployers(caller.owner);
    return { lead: `${employers.length} Employers.`, data: employers };
  }),

  get_employer: reg(
    z.object({ employer: id.describe("An Employer's id or code") }),
    async (input, caller) => {
      const found = await getEmployer(caller.owner, input.employer);
      if (!found)
        throw new NotFoundError("No such Employer in this Workspace.");
      return {
        lead: `${found.employer.name} (${found.employer.code}), ${found.schedules.length} Schedules.`,
        data: found,
      };
    },
  ),

  list_schedules: reg(
    z.object({
      employerId: z.string().optional(),
      period: z
        .string()
        .regex(/^\d{4}-\d{2}(-01)?$/, "period is a month, YYYY-MM")
        .optional(),
    }),
    async (input, caller) => {
      const schedules = await listSchedules(caller.owner, {
        employerId: input.employerId ?? null,
        period: input.period ? `${input.period.slice(0, 7)}-01` : null,
      });
      return { lead: `${schedules.length} Schedules.`, data: schedules };
    },
  ),

  list_member_requests: reg(
    z.object({
      kind: z.enum(MEMBER_REQUEST_KINDS).optional(),
      memberId: z.string().optional(),
      status: z
        .enum([
          "received",
          "in_review",
          "approved",
          "returned",
          "paid",
          "closed",
        ] satisfies MemberRequestStatus[])
        .optional(),
    }),
    async (input, caller) => {
      const requests = await listMemberRequests(caller.owner, {
        kind: input.kind ?? null,
        memberId: input.memberId ?? null,
        status: input.status ?? null,
      });
      return { lead: `${requests.length} Member requests.`, data: requests };
    },
  ),

  search_knowledge: reg(
    z.object({
      query: z.string().min(2).max(300),
      limit: limit(12),
    }),
    async (input, caller) => {
      const hits = await searchKnowledge(
        caller.visitor,
        caller.owner,
        input.query,
        input.limit ?? 8,
      );
      const conflictOpen = hits.some((hit) => hit.conflictOpen);
      return {
        lead: `${hits.length} Passages.${conflictOpen ? " A Conflict is open on at least one: say so." : ""}`,
        data: {
          conflictOpen,
          hits: hits.map((hit) => ({
            citation: `[P${hit.passageId}]`,
            sourceId: hit.sourceId,
            sourceTitle: hit.sourceTitle,
            documentDate: hit.documentDate,
            heading: hit.heading,
            body: hit.body,
            conflictOpen: hit.conflictOpen,
          })),
        },
      };
    },
  ),

  read_source: reg(z.object({ sourceId: id }), async (input, caller) => {
    const found = await readSource(caller.owner, input.sourceId);
    if (!found)
      throw new NotFoundError("That Source is not in this Workspace.");
    if (found.source.status === "pending") {
      // Attached, not filed: no Passages yet, so the Agent reads the file's text.
      const read = await readSourceText(caller.owner, input.sourceId);
      if (!read)
        throw new NotFoundError("That Source is not in this Workspace.");
      const text = read.text.slice(0, TEXT_CHARS);
      const cut = read.text.length > text.length;
      return {
        lead: `"${read.source.title}" (${read.source.kind}) is attached and not filed: it has no Passages, so there is nothing to cite. Its text follows${cut ? ` (first ${TEXT_CHARS.toLocaleString("en-US")} of ${read.text.length.toLocaleString("en-US")} characters)` : ""}. Call file_source only if the person wants it kept in the Knowledge base.\n\n${text}`,
        data: {
          source: {
            id: read.source.id,
            title: read.source.title,
            kind: read.source.kind,
            status: read.source.status,
            documentDate: read.source.documentDate,
            openConflicts: 0,
          },
          passages: [],
        },
      };
    }
    return {
      lead: `"${found.source.title}" (${found.source.kind}, ${found.source.status}), ${found.passages.length} Passages.`,
      data: {
        source: {
          id: found.source.id,
          title: found.source.title,
          kind: found.source.kind,
          status: found.source.status,
          documentDate: found.source.documentDate,
          openConflicts: found.source.openConflicts,
        },
        passages: found.passages.map((passage) => ({
          citation: `[P${passage.id}]`,
          heading: passage.heading,
          body: passage.body,
          ...(passage.supersededBy
            ? { supersededBy: `[P${passage.supersededBy}]` }
            : {}),
        })),
      },
    };
  }),

  list_sources: reg(noInput, async (_input, caller) => {
    // Attached-but-unfiled Sources are not in the Knowledge base yet.
    const sources = await listSources(caller.owner, { filedOnly: true });
    return {
      lead: `${sources.length} Sources.`,
      data: sources.map((source) => ({
        id: source.id,
        title: source.title,
        kind: source.kind,
        status: source.status,
        documentDate: source.documentDate,
        passages: source.passages,
        openConflicts: source.openConflicts,
        isSeed: source.isSeed,
      })),
    };
  }),

  add_source_text: reg(
    z.object({
      title: z.string().min(1).max(200),
      text: z.string().min(1).max(100_000),
      kind: z.enum(["text", "web"]).optional(),
      documentDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "documentDate is YYYY-MM-DD")
        .optional()
        .describe("The date the document itself carries"),
    }),
    async (input, caller) => {
      const result = await addTextSource({
        owner: caller.owner,
        staff: caller.staff,
        visitor: caller.visitor,
        title: input.title,
        text: input.text,
        kind: input.kind ?? "text",
        documentDate: input.documentDate ?? null,
        sessionId: caller.claims.sessionId ?? null,
      });
      return ingested(result);
    },
  ),

  file_source: reg(z.object({ sourceId: id }), async (input, caller) => {
    const result = await ingestSource({
      owner: caller.owner,
      staff: caller.staff,
      visitor: caller.visitor,
      sourceId: input.sourceId,
    });
    return ingested(result);
  }),

  list_conflicts: reg(
    z.object({ status: z.enum(["open", "resolved"]).optional() }),
    async (input, caller) => {
      const conflicts = await listConflicts(caller.owner, {
        status: input.status ?? null,
      });
      return {
        lead: `${conflicts.length} Conflicts. Only an admin settles one, in the app.`,
        data: conflicts.map((conflict) => ({
          id: conflict.id,
          status: conflict.status,
          summary: conflict.summary,
          proposal: conflict.proposal,
          resolution: conflict.resolution,
          newPassage: `[P${conflict.newPassage.passageId}] ${conflict.newPassage.sourceTitle}`,
          oldPassage: `[P${conflict.oldPassage.passageId}] ${conflict.oldPassage.sourceTitle}`,
        })),
      };
    },
  ),

  list_skills: reg(noInput, async (_input, caller) => {
    const skills = await listSkills(caller.owner);
    return {
      lead: `${skills.length} Skills.`,
      data: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        kind: skill.kind,
        pipelineId: skill.pipelineId,
        version: skill.version,
        edited: skill.edited,
      })),
    };
  }),

  get_skill: reg(
    z.object({ skill: id.describe("The Skill's id or name") }),
    async (input, caller) => {
      const skill =
        (await getSkill(caller.owner, input.skill)) ??
        (await listSkills(caller.owner)).find(
          (item) => item.name === input.skill,
        ) ??
        null;
      if (!skill) throw new NotFoundError("No such Skill.");
      return {
        lead: `Skill ${skill.name}${skill.kind === "rulebook" ? " (Rulebook, the Rules in force now)" : ""}, Version ${skill.version}:\n\n${renderSkillMd(skill)}`,
      };
    },
  ),

  list_rules: reg(
    z.object({ pipelineId: z.enum(PIPELINE_IDS).optional() }),
    async (input, caller) => {
      const rules = await listRules(caller.owner, input.pipelineId ?? null);
      return {
        lead: `${rules.length} Rules.`,
        data: rules.map((rule) => ({
          id: rule.spec.id,
          pipelineId: rule.spec.pipelineId,
          step: rule.spec.stepId,
          rule: ruleSentenceText(rule.spec, rule.state.params),
          enabled: rule.state.enabled,
          outcome: rule.state.outcome,
          version: rule.state.version,
          effectiveFrom: rule.state.effectiveFrom,
          citation: rule.spec.citation,
        })),
      };
    },
  ),

  list_audit: reg(
    z.object({
      sessionId: z.string().optional(),
      actorKind: z.enum(ACTOR_KINDS).optional(),
      action: z.enum(AUDIT_ACTION_IDS as [string, ...string[]]).optional(),
      before: z.number().int().optional().describe("For the next page"),
      limit: limit(100),
    }),
    async (input, caller) => {
      const page = await listAudit({
        owner: caller.owner,
        staff: caller.staff,
        sessionId: input.sessionId ?? null,
        actorKind: input.actorKind ?? null,
        action: (input.action as (typeof AUDIT_ACTION_IDS)[number]) ?? null,
        before: input.before ?? null,
        limit: input.limit ?? 50,
      });
      return {
        lead: `${page.events.length} Audit events (${page.scope === "workspace" ? "the whole Workspace" : "your own Sessions"}).`,
        data: {
          scope: page.scope,
          nextBefore: page.nextBefore,
          events: page.events.map((event) => ({
            id: event.id,
            at: event.createdAt,
            who: event.actorLabel,
            action: event.action,
            summary: event.summary,
            sessionId: event.sessionId,
            runId: event.runId,
            ...(event.model
              ? {
                  model: event.model,
                  tokens: (event.inputTokens ?? 0) + (event.outputTokens ?? 0),
                  costUsd: event.costUsd,
                }
              : {}),
          })),
        },
      };
    },
  ),

  code_write_file: reg(
    z.object({
      path: z.string().min(1).max(200),
      content: z.string().max(256 * 1024),
      sessionId: sessionArg,
    }),
    async (input, caller) => {
      const sessionId = await sandboxSession(caller, input.sessionId);
      const file = await sandboxWriteFile({
        owner: caller.owner,
        staff: caller.staff,
        visitor: caller.visitor,
        sessionId,
        path: input.path,
        content: input.content,
        via: "agent",
      });
      return {
        lead: `Wrote ${file.path} (${file.bytes} bytes).${sandboxNote(file)}`,
        data: file,
      };
    },
  ),

  code_run: reg(
    z.object({
      command: z.string().min(1).max(2_000),
      sessionId: sessionArg,
    }),
    async (input, caller) => {
      const sessionId = await sandboxSession(caller, input.sessionId);
      const result = await sandboxRun({
        owner: caller.owner,
        staff: caller.staff,
        visitor: caller.visitor,
        sessionId,
        command: input.command,
        via: "agent",
      });
      return {
        lead: `Exit ${result.exitCode ?? "none"}${result.timedOut ? " (timed out)" : ""}${result.truncated ? " (output cut)" : ""}.${sandboxNote(result)}`,
        data: result,
      };
    },
  ),

  code_read_file: reg(
    z.object({ path: z.string().min(1).max(200), sessionId: sessionArg }),
    async (input, caller) => {
      const sessionId = await sandboxSession(caller, input.sessionId);
      const file = await sandboxReadFile({
        owner: caller.owner,
        staff: caller.staff,
        sessionId,
        path: input.path,
      });
      return {
        lead: `${file.path} (${file.bytes} bytes${file.truncated ? ", cut" : ""}).`,
        data: file,
      };
    },
  ),

  code_list_files: reg(
    z.object({
      path: z.string().max(200).optional(),
      sessionId: sessionArg,
    }),
    async (input, caller) => {
      const sessionId = await sandboxSession(caller, input.sessionId);
      const files = await sandboxListFiles({
        owner: caller.owner,
        staff: caller.staff,
        sessionId,
        ...(input.path ? { path: input.path } : {}),
      });
      return { lead: `${files.length} entries.`, data: files };
    },
  ),
};

/** What an ingest added, with a card per Source and Conflict. */
function ingested(result: {
  source: { id: string; title: string; status: string; passages: number };
  conflicts: { id: string; summary: string }[];
}): Outcome {
  const { source, conflicts } = result;
  return {
    lead: `"${source.title}" is ${source.status} with ${source.passages} Passages${
      conflicts.length > 0
        ? `. ${conflicts.length} Conflict${conflicts.length === 1 ? "" : "s"} found: an admin settles them in the app.`
        : "."
    }`,
    data: {
      sourceId: source.id,
      title: source.title,
      status: source.status,
      passages: source.passages,
      conflicts: conflicts.map((conflict) => ({
        id: conflict.id,
        summary: conflict.summary,
      })),
    },
    cards: {
      sources: [{ sourceId: source.id, title: source.title }],
      conflicts: conflicts.map((conflict) => ({
        conflictId: conflict.id,
        summary: conflict.summary,
      })),
    },
  };
}

/** Registers every tool in `MCP_TOOLS`: one per Pipeline, then the rest. */
export function registerHarnessTools(server: McpServer) {
  registerPipelineTools(server);
  for (const spec of STATIC_MCP_TOOLS) {
    const registration = TOOLS[spec.name];
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: registration.input,
        annotations: { readOnlyHint: spec.readOnly },
      },
      handle(spec, registration.work),
    );
  }
}

// The handler --------------------------------------------------------------------------------

const handler = createMcpHandler(registerHarnessTools, {
  serverInfo: { name: MCP_SERVER_NAME, version: "1.0.0" },
});

/** Each request's bearer is checked once, by the guest check and by the auth wrapper. */
const verified = new WeakMap<Request, Promise<HarnessClaims | null>>();
function verifiedClaims(request: Request, bearer: string) {
  let claims = verified.get(request);
  if (!claims) {
    claims = verifyBearer(bearer);
    verified.set(request, claims);
  }
  return claims;
}

function bearerOf(request: Request) {
  const [type, token] = request.headers.get("authorization")?.split(" ") ?? [];
  return type?.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * Every request carries a Harness token (chat, OAuth or pasted); its holder
 * must still have Access and its Staff member must still be the Owner's. The
 * 401 names the Harness's own resource metadata, which names its own issuer.
 */
const authenticated = withMcpAuth(
  handler,
  async (request, bearer) => {
    if (!bearer) return undefined;
    const claims = await verifiedClaims(request, bearer);
    if (!claims) return undefined;
    const actor = await actorOf(claims);
    if (!actor) return undefined;
    return {
      token: bearer,
      clientId: `harness-${claims.via}`,
      scopes: ["harness"],
      expiresAt: claims.exp,
      extra: { actor, origin: getPublicOrigin(request) },
    };
  },
  { required: true, resourceMetadataPath: HARNESS_PROTECTED_RESOURCE_PATH },
);

/**
 * The Harness MCP server's entry point. A Guest signed in with OAuth must
 * also send their pasted Harness token (ADR 0012): refused with a 403 that
 * says so, not a 401, which would only send the client to sign in again.
 */
export async function mcpHandler(request: Request): Promise<Response> {
  const bearer = bearerOf(request);
  const claims = bearer ? await verifiedClaims(request, bearer) : null;
  const problem = claims
    ? guestTokenProblem(
        claims,
        request.headers.get(GUEST_TOKEN_HEADER),
        env.rateLimitSalt(),
      )
    : null;
  if (problem) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: problem }, id: null },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  return authenticated(request);
}
