import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { unstable_rethrow } from "next/navigation";
import { ZodError, z } from "zod";
import {
  ForbiddenError,
  InvalidError,
  isAppError,
  NotFoundError,
} from "@/platform/errors";
import {
  attachmentList,
  isSourceId,
  resolveSourceRef,
} from "../domain/attachments";
import {
  ACTOR_KINDS,
  AUDIT_ACTION_IDS,
  type AuditActor,
} from "../domain/audit";
import { cutArgs, type ToolCards } from "../domain/chat-turn";
import { AGENT_TEXT_CHARS } from "../domain/knowledge";
import { LIMITS } from "../domain/limits";
import {
  GUEST_TOKEN_HEADER,
  HARNESS_PROTECTED_RESOURCE_PATH,
  MCP_SERVER_NAME,
  type McpToolSpec,
  pipelineTool,
  runLink,
  STATIC_MCP_TOOLS,
  type StaticToolName,
} from "../domain/mcp-tools";
import { guestTokenProblem, type HarnessClaims } from "../domain/oauth";
import { refusalFor } from "../domain/permissions";
import { levels, PIPELINE_IDS } from "../domain/pipeline";
import { PIPELINES } from "../domain/pipelines";
import { pipelineInputSchema } from "../domain/pipelines/tool-schema";
import {
  MEMBER_REQUEST_KINDS,
  type MemberRequestStatus,
} from "../domain/records";
import { listedRule } from "../domain/rules";
import type { RunView } from "../domain/run";
import { sandboxNote } from "../domain/sandbox";
import { renderSkillMd } from "../domain/skills";
import { auditLog } from "./audit";
import { env } from "./env";
import { actorOf, type McpActor, verifyBearer } from "./mcp-auth";
import type { HarnessServices } from "./services";

/*
 * The Harness MCP server (ADR 0013): the only way in, for the built-in chat
 * and for Claude alike. Every request carries a Harness token; every tool
 * runs on the same services as the REST routes, applies the same Role
 * policy to the token's Staff member, scopes to the Owner and writes an
 * Audit event. No tool gives an Approval or settles a Conflict: a person
 * does that in the app.
 */

/** The services an MCP request runs on: the route's (live or stub), or the chat turn's own. */
export type McpServices = Omit<HarnessServices, "chat">;

// Answers ------------------------------------------------------------------------------

/** What a tool hands back: a lead line for the model, the data, and any cards for the chat. */
type Outcome = {
  lead: string;
  data?: unknown;
  cards?: ToolCards;
};

const TEXT_CHARS = AGENT_TEXT_CHARS;

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

/**
 * What the model is told when a tool fails: the reason when it is one a
 * person can act on (a service's refusal, a Sandbox that is unavailable),
 * the first schema issue for bad arguments, and a plain phrase otherwise.
 */
function refusalOf(error: unknown): string {
  if (isAppError(error)) return error.message;
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

// Who is calling -----------------------------------------------------------------------

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

type Caller = McpActor & { origin: string; services: McpServices };

function callerOf(ctx: unknown): Caller {
  const extra = (ctx as ToolContext).http?.authInfo?.extra;
  const actor = extra?.actor as McpActor | undefined;
  const services = extra?.services as McpServices | undefined;
  if (!actor || !services)
    throw new ForbiddenError("Not signed in to the Harness.");
  return { ...actor, services, origin: String(extra?.origin ?? "") };
}

/** The chat's tokens act as the Agent; anyone else's as the Staff member. */
function auditActorOf(caller: Caller): AuditActor {
  return caller.claims.via === "chat"
    ? { kind: "agent" }
    : { kind: "staff", staff: caller.staff };
}

/** The Session the token was minted for (the chat's), if any. */
const sessionOf = (caller: Caller) => caller.claims.sessionId ?? null;

/**
 * Runs one tool for the caller: the Role policy (`refusalFor`, the same as
 * the REST routes' `permits`), the work, and a `tool.called` or
 * `tool.failed` Audit event. Any error becomes a clean tool error.
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
      return failed(refusalOf(error));
    }
    const record = (ok: boolean, extra: Record<string, unknown> = {}) =>
      recordTool(caller, spec, ok, cutArgs(input), extra);
    try {
      const refusal = spec.permission
        ? refusalFor(caller.staff, spec.permission)
        : null;
      if (refusal !== null) throw new ForbiddenError(refusal);
      const outcome = await work(input, caller);
      await record(true);
      return answer(outcome);
    } catch (error) {
      unstable_rethrow(error);
      const message = refusalOf(error);
      if (!isAppError(error) && !(error instanceof ZodError))
        console.error("[harness] mcp tool", spec.name, error);
      await record(false, { error: message });
      return failed(message);
    }
  };
}

/** `tool.called` / `tool.failed`, best effort. */
async function recordTool(
  caller: Caller,
  spec: McpToolSpec,
  ok: boolean,
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) {
  await auditLog
    .record({
      owner: caller.owner,
      sessionId: sessionOf(caller),
      actor: auditActorOf(caller),
      action: ok ? "tool.called" : "tool.failed",
      summary: `${ok ? "Called" : "Failed"} ${spec.name}`,
      target: { kind: "tool", id: spec.name },
      detail: {
        tool: spec.name,
        via: caller.claims.via,
        staff: { id: caller.staff.id, name: caller.staff.name },
        args,
        ...extra,
      },
    })
    .catch(() => null);
}

const absolute = (caller: Caller, path: string) =>
  caller.origin ? `${caller.origin}${path}` : path;

// Source references ----------------------------------------------------------------------

/**
 * The Source id a tool was given. A UUID passes through (the service checks
 * it is the Owner's). Anything else is looked up among this Session's
 * attachments by file name or title, and used only when exactly one fits.
 * Without a Session (an outside MCP client) only ids resolve. The refusal
 * lists the attachments, so the model can correct itself.
 */
async function sourceIdOf(caller: Caller, ref: string): Promise<string> {
  if (isSourceId(ref)) return ref.trim().toLowerCase();
  const sessionId = sessionOf(caller);
  const attachments = sessionId
    ? await caller.services.sessions.attachments(caller.owner, sessionId)
    : [];
  const result = resolveSourceRef(ref, attachments);
  if (!result.ok) {
    throw new InvalidError(
      sessionId
        ? result.message
        : `"${ref.slice(0, 80)}" is not a Source id. Give the id (a UUID) from list_sources.`,
    );
  }
  return result.sourceId;
}

/** A hint appended to a "not found" for a Session's attachments, so a wrong id can be corrected in one step. */
async function attachmentsHint(caller: Caller): Promise<string> {
  const sessionId = sessionOf(caller);
  if (!sessionId) return "";
  const attachments = await caller.services.sessions.attachments(
    caller.owner,
    sessionId,
  );
  if (attachments.length === 0) return "";
  return ` Attached in this Session:\n${attachmentList(attachments)}`;
}

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
      handle(tool, async (given: Record<string, unknown>, caller) => {
        // A model that names a paper by its file name is helped to its id.
        const input = { ...given };
        for (const field of spec.inputSchema) {
          if (field.type !== "id") continue;
          const value = input[field.name];
          if (typeof value === "string") {
            input[field.name] = await sourceIdOf(caller, value);
          } else if (Array.isArray(value)) {
            const ids: string[] = [];
            for (const ref of value) {
              if (typeof ref === "string")
                ids.push(await sourceIdOf(caller, ref));
            }
            input[field.name] = [...new Set(ids)];
          }
        }
        const run = await caller.services.runs.start(caller, {
          sessionId: sessionOf(caller),
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

/**
 * The Run, once it has left `queued` and `running` or `LIMITS.runWaitMs` has
 * passed: a Run with model Steps takes half a minute or more, and an Agent
 * that polls re-sends its whole conversation on every call.
 */
async function settledRun(caller: Caller, runId: string) {
  const until = Date.now() + LIMITS.runWaitMs;
  for (;;) {
    const run = await caller.services.runs.get(caller, runId);
    const atWork = run.status === "queued" || run.status === "running";
    if (!atWork || Date.now() >= until) return run;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

// The rest -----------------------------------------------------------------------------------

const id = z.string().min(1).max(120);
/** A Source's id; a file name or title of this Session's attachments is also understood. */
const sourceRef = id.describe(
  "The Source's id (a UUID). A file name or title of a Source attached in this Session also works when it is unambiguous.",
);
const limit = (max: number) =>
  z.number().int().min(1).max(max).optional().describe(`At most ${max}`);
const sessionArg = z
  .string()
  .optional()
  .describe(
    "The Session whose Sandbox to use. Needed outside the built-in chat; must be a Session of the Staff member you act as.",
  );

/** The Session a Sandbox tool works in: the chat's own, or one the Staff member owns (the service checks). */
function sandboxSession(caller: Caller, given: string | undefined): string {
  const own = caller.claims.via === "chat" ? sessionOf(caller) : null;
  if (own) return own;
  if (!given)
    throw new InvalidError(
      "Give sessionId: a Session of the Staff member you act as (open one in the app).",
    );
  return given;
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
    const run = await settledRun(caller, input.runId);
    const brief = runBrief(run, caller);
    return {
      lead: `${run.subject}: ${run.status}.${brief.waitingFor ? ` Waiting for a person: ${brief.waitingFor.join(" ")}` : ""}`,
      data: brief,
    };
  }),

  list_runs: reg(
    z.object({ sessionId: z.string().optional(), limit: limit(50) }),
    async (input, caller) => {
      const runs = await caller.services.runs.list(caller, {
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
    const run = await caller.services.runs.stop(caller, input.runId);
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
      const members = await caller.services.records.members(caller, {
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
      const found = await caller.services.records.member(caller, input.member);
      return {
        lead: `${found.member.fullName} (${found.member.memberNo}).`,
        data: found,
      };
    },
  ),

  list_employers: reg(noInput, async (_input, caller) => {
    const employers = await caller.services.records.employers(caller);
    return { lead: `${employers.length} Employers.`, data: employers };
  }),

  get_employer: reg(
    z.object({ employer: id.describe("An Employer's id or code") }),
    async (input, caller) => {
      const found = await caller.services.records.employer(
        caller,
        input.employer,
      );
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
      const schedules = await caller.services.records.schedules(caller, {
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
      const requests = await caller.services.records.memberRequests(caller, {
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
      const hits = await caller.services.knowledge.search(
        caller,
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

  read_source: reg(z.object({ sourceId: sourceRef }), async (input, caller) => {
    const { knowledge } = caller.services;
    const sourceId = await sourceIdOf(caller, input.sourceId);
    const found = await knowledge
      .source(caller, sourceId)
      .catch(async (error: unknown) => {
        if (!(error instanceof NotFoundError)) throw error;
        throw new NotFoundError(
          `That Source is not in this Workspace.${await attachmentsHint(caller)}`,
        );
      });
    if (found.source.status === "pending") {
      // Attached, not filed: no Passages yet, so the Agent reads the file's text.
      const read = await knowledge.text(caller, sourceId);
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

  list_attachments: reg(noInput, async (_input, caller) => {
    const sessionId = sessionOf(caller);
    if (!sessionId) {
      throw new InvalidError(
        "Attachments belong to a Session, and this connection has none. Use list_sources for the Knowledge base.",
      );
    }
    const attachments = await caller.services.sessions.attachments(
      caller.owner,
      sessionId,
    );
    return {
      lead: `${attachments.length} attached in this Session (filed or not). Pass an id to read_source, file_source or a Pipeline.`,
      data: attachments.map((item) => ({
        id: item.sourceId,
        title: item.title,
        kind: item.kind,
        filed: item.status !== "pending",
        status: item.status,
      })),
    };
  }),

  list_sources: reg(noInput, async (_input, caller) => {
    // Attached-but-unfiled Sources are not in the Knowledge base yet.
    const sources = await caller.services.knowledge.sources(caller, {
      filedOnly: true,
    });
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
    async (input, caller) =>
      ingested(
        await caller.services.knowledge.addText(caller, {
          title: input.title,
          text: input.text,
          kind: input.kind ?? "text",
          documentDate: input.documentDate ?? null,
          sessionId: sessionOf(caller),
        }),
      ),
  ),

  file_source: reg(z.object({ sourceId: sourceRef }), async (input, caller) =>
    ingested(
      await caller.services.knowledge.ingest(
        caller,
        await sourceIdOf(caller, input.sourceId),
      ),
    ),
  ),

  list_conflicts: reg(
    z.object({ status: z.enum(["open", "resolved"]).optional() }),
    async (input, caller) => {
      const conflicts = await caller.services.knowledge.conflicts(caller, {
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
    const skills = await caller.services.skills.list(caller);
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
      const skill = await caller.services.skills.find(caller, input.skill);
      if (!skill) throw new NotFoundError("No such Skill.");
      return {
        lead: `Skill ${skill.name}${skill.kind === "rulebook" ? " (Rulebook, the Rules in force now)" : ""}, Version ${skill.version}:\n\n${renderSkillMd(skill)}`,
      };
    },
  ),

  list_rules: reg(
    z.object({ pipelineId: z.enum(PIPELINE_IDS).optional() }),
    async (input, caller) => {
      const rules = await caller.services.rules.list(
        caller,
        input.pipelineId ?? null,
      );
      return {
        lead: `${rules.length} Rules, as a Run started today applies them (inForce), with any change scheduled for a later date (scheduled).`,
        data: rules.map(listedRule),
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
      const page = await caller.services.audit.list(caller, {
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
      const file = await caller.services.sandbox.write(
        caller,
        { sessionId: sandboxSession(caller, input.sessionId), via: "agent" },
        input.path,
        input.content,
      );
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
      const result = await caller.services.sandbox.run(
        caller,
        { sessionId: sandboxSession(caller, input.sessionId), via: "agent" },
        input.command,
      );
      return {
        lead: `Exit ${result.exitCode ?? "none"}${result.timedOut ? " (timed out)" : ""}${result.truncated ? " (output cut)" : ""}.${sandboxNote(result)}`,
        data: result,
      };
    },
  ),

  code_read_file: reg(
    z.object({ path: z.string().min(1).max(200), sessionId: sessionArg }),
    async (input, caller) => {
      const file = await caller.services.sandbox.read(
        caller,
        sandboxSession(caller, input.sessionId),
        input.path,
      );
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
      const files = await caller.services.sandbox.list(
        caller,
        sandboxSession(caller, input.sessionId),
        input.path,
      );
      return { lead: `${files.length} entries.`, data: files };
    },
  ),
};

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
/** The services each request runs on, for the auth wrapper to hand the tools. */
const servicesOf = new WeakMap<Request, McpServices>();

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
    const services = servicesOf.get(request);
    if (!services) return undefined;
    const claims = await verifiedClaims(request, bearer);
    if (!claims) return undefined;
    const actor = await actorOf(claims);
    if (!actor) return undefined;
    return {
      token: bearer,
      clientId: `harness-${claims.via}`,
      scopes: ["harness"],
      expiresAt: claims.exp,
      extra: { actor, services, origin: getPublicOrigin(request) },
    };
  },
  { required: true, resourceMetadataPath: HARNESS_PROTECTED_RESOURCE_PATH },
);

/**
 * The Harness MCP server's entry point, on the services given: the route's
 * (live, or stubbed for the e2e suite), or a chat turn's own. A Guest signed
 * in with OAuth must also send their pasted Harness token (ADR 0012):
 * refused with a 403 that says so, not a 401, which would only send the
 * client to sign in again.
 */
export async function mcpHandler(
  request: Request,
  services: McpServices,
): Promise<Response> {
  servicesOf.set(request, services);
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
