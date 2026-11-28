import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { isAppError } from "@/platform/errors";
import { CHECKS } from "../domain/checks";
import { kindLabel } from "../domain/document-kinds";
import { JOB_IDS, JOBS, planJobs } from "../domain/jobs";
import { PIPELINE_IDS, PIPELINES, type PipelineId } from "../domain/pipelines";
import { answerSchema } from "../domain/run-events";
import type { SessionRow } from "./repository";
import type { DeskService } from "./services/desks";
import type { RunService } from "./services/runs";
import { verifySessionToken } from "./session";

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type ToolContext = {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

function result(data: unknown, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function refusal(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

const documentIds = z
  .array(z.string())
  .min(1)
  .max(12)
  .describe("Ids of Documents in the Cabinet or uploaded to this desk");

export type McpServices = {
  desks: DeskService;
  runs: RunService;
  /** `CASEWORK_MCP_TOKEN`: lets an outside MCP client in; empty when unset. */
  outsideToken: () => string;
};

/**
 * The Casework MCP server over the same services as the REST routes: every
 * Job and Pipeline as a tool, plus readiness, stop, find, answer and spend.
 * The desk's chat calls it with a session token; an outside client may call
 * it with CASEWORK_MCP_TOKEN when that is set. A refusal a service throws on
 * purpose (a cap, a Run already going, a Run of another Desk) is the tool's
 * error answer, as the REST routes answer it with its status.
 */
export function createCaseworkMcp(services: McpServices) {
  const { desks, runs } = services;

  /**
   * The Desk a call acts for: the token's, and only while the Desk still
   * belongs to the Owner the token was minted for (null only for the outside
   * client's desk).
   */
  async function deskOf(ctx: unknown): Promise<SessionRow> {
    const extra = (ctx as ToolContext).http?.authInfo?.extra;
    const sessionId = extra?.sessionId;
    const owner = extra?.owner;
    if (
      typeof sessionId !== "string" ||
      !(owner === null || typeof owner === "string")
    )
      throw new Error("Not authorised");
    return desks.forToken(sessionId, owner as SessionRow["owner"]);
  }

  /** A tool body: the Desk, then the work; a service's refusal is the tool's error. */
  function act<A>(
    work: (desk: SessionRow, args: A) => Promise<ReturnType<typeof result>>,
  ) {
    return async (args: A, ctx: unknown) => {
      try {
        return await work(await deskOf(ctx), args);
      } catch (error) {
        if (isAppError(error)) return refusal(error.message);
        throw error;
      }
    };
  }

  const launch = (input: { pipeline?: PipelineId | null; jobs?: string[] }) =>
    act<{ documentIds: string[] }>(async (desk, args) => {
      const run = await runs.start(desk, {
        ...input,
        documentIds: args.documentIds,
      });
      return result(
        { ...run, status: "running" },
        `Started run ${run.runId}: ${run.pipeline ? PIPELINES[run.pipeline].title : run.jobs.join(" → ")} over ${run.documents.map((document) => document.name).join(", ")}. It streams to the desk; questions it raises will appear there.`,
      );
    });

  /** Registers every Job and Pipeline as a tool. A new Job in the registry is a new tool. */
  function register(server: McpServer) {
    for (const id of PIPELINE_IDS) {
      const pipeline = PIPELINES[id];
      server.registerTool(
        `pipeline_${id}`,
        {
          title: pipeline.title,
          description: `${pipeline.description} Runs: ${pipeline.jobs.map((job) => JOBS[job].title).join(" → ")}. Returns a runId at once; the run streams and may ask for missing documents.`,
          inputSchema: z.object({ documentIds }),
        },
        launch({ pipeline: id }),
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
        launch({ jobs: [id] }),
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
      launch({}),
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
      act<{ documentIds: string[] }>(async (desk, args) => {
        const ready = await runs.readiness(desk, args.documentIds);
        return result(
          ready,
          ready.ready
            ? `Ready: ${ready.documents.map((document) => document.name).join(", ")}.`
            : `Not ready. ${ready.problems.join(" ")}`,
        );
      }),
    );

    server.registerTool(
      "stop_run",
      {
        title: "Stop a run",
        description:
          "Stops a run that is going or waiting on a question. With no runId, stops whatever this desk has going. Use when the person says stop, cancel, abort or never mind.",
        inputSchema: z.object({ runId: z.string().optional() }),
      },
      act<{ runId?: string }>(async (desk, args) => {
        const stopped = args.runId
          ? await runs.stop(desk, args.runId)
          : await runs.stopActive(desk);
        return result(
          stopped,
          stopped.stopped
            ? `Stopped run ${stopped.runId}.`
            : "Nothing was running.",
        );
      }),
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
            .describe(
              "Words from a folder title, person, company or file name",
            ),
        }),
        annotations: { readOnlyHint: true },
      },
      act<{ query: string }>(async (desk, args) => {
        const found = await desks.find(desk, args.query);
        const places = [...new Set(found.map((item) => item.folder))];
        return result(
          { documents: found },
          found.length === 0
            ? `Nothing in the Cabinet matches "${args.query}".`
            : `${found.length} document${found.length === 1 ? "" : "s"} in ${places.slice(0, 3).join("; ")}${places.length > 3 ? ` and ${places.length - 3} more folders` : ""}: ${found.map((item) => `${item.name} (id ${item.id}, ${item.folder})`).join("; ")}`,
        );
      }),
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
      act<{ runId: string }>(async (desk, args) => {
        const { run, question } = await runs.get(desk, args.runId);
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
      }),
    );

    server.registerTool(
      "answer_question",
      {
        title: "Answer a question",
        description:
          "Answers a question a waiting run asked: with Document ids that supply what it needs, a choice from its options, a short text, or skip to go on without it.",
        inputSchema: answerSchema.extend({ questionId: z.string() }),
      },
      act<z.infer<typeof answerSchema> & { questionId: string }>(
        async (desk, args) => {
          const answered = await runs.answer(desk, args.questionId, {
            documentIds: args.documentIds,
            choice: args.choice,
            text: args.text,
            skip: args.skip,
          });
          return result(
            answered,
            answered.alreadyAnswered
              ? "Already answered."
              : "Answered; the run carries on.",
          );
        },
      ),
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
      act<Record<string, never>>(async (desk) => {
        const spend = await desks.spend(desk.id);
        return result({
          totalUsd: Number(spend.totalUsd.toFixed(6)),
          rows: spend.rows,
        });
      }),
    );
  }

  const handler = createMcpHandler(register, {
    serverInfo: { name: "casework", version: "1.0.0" },
  });

  return withMcpAuth(
    handler,
    async (_request, bearer) => {
      if (!bearer) return undefined;
      const claims = verifySessionToken(bearer);
      if (claims) {
        return {
          token: bearer,
          clientId: "casework-desk",
          scopes: ["casework"],
          expiresAt: claims.exp,
          extra: { sessionId: claims.sessionId, owner: claims.owner },
        };
      }
      const outside = services.outsideToken();
      if (outside && sameSecret(bearer, outside)) {
        return {
          token: bearer,
          clientId: "casework-external",
          scopes: ["casework"],
          extra: { sessionId: await desks.external(), owner: null },
        };
      }
      return undefined;
    },
    { required: true },
  );
}
