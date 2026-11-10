import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { CHECKS } from "../domain/checks";
import { kindLabel } from "../domain/document-kinds";
import { JOB_IDS, JOBS, planJobs } from "../domain/jobs";
import { PIPELINE_IDS, PIPELINES, type PipelineId } from "../domain/pipelines";
import { answerSchema } from "../domain/run-events";
import { env } from "./env";
import {
  createSession,
  getRun,
  getSession,
  loadCabinetDocuments,
  loadCaseFiles,
  openQuestions,
  type SessionRow,
  sessionSpend,
} from "./repository";
import {
  answerQuestion,
  LimitError,
  readiness,
  startRun,
  stopActiveRun,
  stopRun,
} from "./runs";
import { verifySessionToken } from "./session";
import { supabase } from "./supabase";

const EXTERNAL_VISITOR = "mcp-external";

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

async function sessionOf(ctx: unknown): Promise<SessionRow> {
  const sessionId = (ctx as ToolContext).http?.authInfo?.extra?.sessionId;
  if (typeof sessionId !== "string") throw new Error("Not authorised");
  const session = await getSession(sessionId);
  if (!session) throw new Error("Session expired");
  return session;
}

function result(data: unknown, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function failure(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

const documentIds = z
  .array(z.string())
  .min(1)
  .max(12)
  .describe("Ids of Documents in the Cabinet or uploaded to this desk");

async function launch(
  ctx: unknown,
  input: {
    pipeline?: PipelineId | null;
    jobs?: string[];
    documentIds: string[];
  },
) {
  try {
    const run = await startRun(await sessionOf(ctx), input);
    return result(
      { ...run, status: "running" },
      `Started run ${run.runId}: ${run.pipeline ? PIPELINES[run.pipeline].title : run.jobs.join(" → ")} over ${run.documents.map((document) => document.name).join(", ")}. It streams to the desk; questions it raises will appear there.`,
    );
  } catch (error) {
    if (error instanceof LimitError) return failure(error);
    throw error;
  }
}

/** Registers every Job and Pipeline as a tool. A new Job in the registry is a new tool. */
export function registerCaseworkTools(server: McpServer) {
  for (const id of PIPELINE_IDS) {
    const pipeline = PIPELINES[id];
    server.registerTool(
      `pipeline_${id}`,
      {
        title: pipeline.title,
        description: `${pipeline.description} Runs: ${pipeline.jobs.map((job) => JOBS[job].title).join(" → ")}. Returns a runId at once; the run streams and may ask for missing documents.`,
        inputSchema: z.object({ documentIds }),
      },
      async (args, ctx) =>
        launch(ctx, { pipeline: id, documentIds: args.documentIds }),
    );
  }

  for (const id of JOB_IDS) {
    const job = JOBS[id];
    const plan = planJobs([id]);
    server.registerTool(
      `job_${id}`,
      {
        title: job.title,
        description: `${job.description}${
          plan.length > 1
            ? ` Runs ${plan
                .filter((item) => item !== id)
                .map((item) => JOBS[item].title)
                .join(", ")} first.`
            : ""
        } Returns a runId at once.`,
        inputSchema: z.object({ documentIds }),
      },
      async (args, ctx) =>
        launch(ctx, { jobs: [id], documentIds: args.documentIds }),
    );
  }

  server.registerTool(
    "review_documents",
    {
      title: "Review documents",
      description:
        "Sorts the Documents, works out which pipeline they call for (withdrawal, employer, structure or screening) and runs it. Use when the person drops documents without saying what to do. Asks when it cannot tell.",
      inputSchema: z.object({ documentIds }),
    },
    async (args, ctx) => launch(ctx, { documentIds: args.documentIds }),
  );

  server.registerTool(
    "check_ready",
    {
      title: "Check readiness",
      description:
        "Checks whether a job or pipeline could start now on these Documents: that they exist, that no other run is going, and that the session has spend left. Call it before starting anything. Starts nothing.",
      inputSchema: z.object({
        documentIds: z.array(z.string()).max(40),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      const ready = await readiness(await sessionOf(ctx), args.documentIds);
      return result(
        ready,
        ready.ready
          ? `Ready: ${ready.documents.map((document) => document.name).join(", ")}.`
          : `Not ready. ${ready.problems.join(" ")}`,
      );
    },
  );

  server.registerTool(
    "stop_run",
    {
      title: "Stop a run",
      description:
        "Stops a run that is going or waiting on a question. With no runId, stops whatever this desk has going. Use when the person says stop, cancel, abort or never mind.",
      inputSchema: z.object({ runId: z.string().optional() }),
    },
    async (args, ctx) => {
      try {
        const session = await sessionOf(ctx);
        const stopped = args.runId
          ? await stopRun(session, args.runId)
          : await stopActiveRun(session);
        return result(
          stopped,
          stopped.stopped
            ? `Stopped run ${stopped.runId}.`
            : "Nothing was running.",
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "find_documents",
    {
      title: "Find documents",
      description:
        "Searches the Cabinet (case folders of synthetic documents) and this desk's uploads by folder or file name. Returns document ids to pass to a job or pipeline.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Words from a folder title, person, company or file name"),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      const session = await sessionOf(ctx);
      const [folders, documents] = await Promise.all([
        loadCaseFiles(),
        loadCabinetDocuments(session.id),
      ]);
      const words = args.query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = documents
        .map((document) => {
          const folder = folders.find(
            (item) => item.slug === document.case_file_slug,
          );
          const haystack =
            `${folder?.title ?? "uploads"} ${folder?.slug ?? ""} ${document.name}`.toLowerCase();
          return {
            document,
            folder,
            score: words.filter((word) => haystack.includes(word)).length,
          };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      const found = matches.map(({ document, folder }) => ({
        id: document.id,
        name: document.name,
        folder: folder?.title ?? "Uploads",
      }));
      const places = [...new Set(found.map((item) => item.folder))];
      return result(
        { documents: found },
        found.length === 0
          ? `Nothing in the Cabinet matches "${args.query}".`
          : `${found.length} document${found.length === 1 ? "" : "s"} in ${places.slice(0, 3).join("; ")}${places.length > 3 ? ` and ${places.length - 3} more folders` : ""}: ${found.map((item) => `${item.name} (id ${item.id}, ${item.folder})`).join("; ")}`,
      );
    },
  );

  server.registerTool(
    "list_capabilities",
    {
      title: "List jobs and pipelines",
      description:
        "Every Job and Pipeline this desk can run, with what each needs.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      result({
        pipelines: PIPELINE_IDS.map((id) => ({
          tool: `pipeline_${id}`,
          title: PIPELINES[id].title,
          jobs: PIPELINES[id].jobs,
        })),
        jobs: JOB_IDS.map((id) => ({
          tool: `job_${id}`,
          title: JOBS[id].title,
          description: JOBS[id].description,
        })),
      }),
  );

  server.registerTool(
    "get_run",
    {
      title: "Get run",
      description:
        "A run's status, plan, checks, decision and any open question waiting for the person.",
      inputSchema: z.object({ runId: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) => {
      const session = await sessionOf(ctx);
      const run = await getRun(args.runId);
      if (!run || run.session_id !== session.id) return failure("No such run");
      const [question] = await openQuestions([run.id]);
      return result({
        runId: run.id,
        status: run.status,
        pipeline: run.pipeline,
        jobs: run.jobs,
        recommendation: run.recommendation,
        decision: run.state?.decision ?? null,
        checks:
          run.state?.checks.map((check) => ({
            title: CHECKS[check.id].title,
            outcome: check.outcome,
            detail: check.detail,
          })) ?? [],
        openQuestion: question
          ? {
              questionId: question.id,
              prompt: question.prompt,
              wants: question.wants.kinds.map(kindLabel),
              options: question.wants.options,
            }
          : null,
      });
    },
  );

  server.registerTool(
    "answer_question",
    {
      title: "Answer a question",
      description:
        "Answers a question a waiting run asked: with Document ids that supply what it needs, a choice from its options, a short text, or skip to go on without it.",
      inputSchema: answerSchema.extend({ questionId: z.string() }),
    },
    async (args, ctx) => {
      try {
        const answered = await answerQuestion(
          await sessionOf(ctx),
          args.questionId,
          {
            documentIds: args.documentIds,
            choice: args.choice,
            text: args.text,
            skip: args.skip,
          },
        );
        return result(
          answered,
          answered.alreadyAnswered
            ? "Already answered."
            : "Answered; the run carries on.",
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_spend",
    {
      title: "Get spend",
      description:
        "Model spend for this desk session, by purpose and model, in USD.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) => {
      const rows = await sessionSpend((await sessionOf(ctx)).id);
      return result({
        totalUsd: Number(
          rows.reduce((sum, row) => sum + row.costUsd, 0).toFixed(6),
        ),
        rows,
      });
    },
  );
}

/** The session an outside MCP client works in: one shared desk, created on first use. */
async function externalSession() {
  const { data } = await supabase()
    .from("sessions")
    .select("id")
    .eq("visitor_hash", EXTERNAL_VISITOR)
    .order("created_at", { ascending: false })
    .limit(1);
  return (
    (data?.[0] as { id: string } | undefined)?.id ??
    createSession(EXTERNAL_VISITOR)
  );
}

const handler = createMcpHandler(registerCaseworkTools, {
  serverInfo: { name: "casework", version: "1.0.0" },
});

/**
 * The Casework MCP server. The desk's chat calls it with a session token;
 * an outside client may call it with CASEWORK_MCP_TOKEN when that is set.
 */
export const mcpHandler = withMcpAuth(
  handler,
  async (_request, bearer) => {
    if (!bearer) return undefined;
    const sessionId = verifySessionToken(bearer);
    if (sessionId) {
      return {
        token: bearer,
        clientId: "casework-desk",
        scopes: ["casework"],
        extra: { sessionId },
      };
    }
    const external = env.mcpToken();
    if (external && sameSecret(bearer, external)) {
      return {
        token: bearer,
        clientId: "casework-external",
        scopes: ["casework"],
        extra: { sessionId: await externalSession() },
      };
    }
    return undefined;
  },
  { required: true },
);
