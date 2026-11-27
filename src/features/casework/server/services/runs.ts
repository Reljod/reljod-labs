import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { isJobId, type JobId, planJobs } from "../../domain/jobs";
import { LIMITS } from "../../domain/limits";
import type { ModelSettingsByPurpose } from "../../domain/model-config";
import { PIPELINES, type PipelineId } from "../../domain/pipelines";
import type { Answer, RunEvent } from "../../domain/run-events";
import type {
  CabinetStore,
  DeskStore,
  RunStore,
  RunWorkflows,
  SpendStore,
} from "../ports";
import type {
  QuestionRow,
  RunRefusal,
  RunRow,
  SessionRow,
} from "../repository";

/**
 * The visitor hash `visitorOf` gives the e2e suite. A Desk it opened is
 * trusted: no rate limits or spend caps, as for the suite's requests.
 */
export const E2E_VISITOR_HASH = "e2e";

const DAY_MS = 86_400_000;
/** A Run older than this that still claims to be going has lost its workflow. */
const STALE_RUN_MS = 45 * 60_000;
/** How long a finished Run's stream may go quiet before its replay ends by itself. */
const IDLE_MS = 2500;

/** What the person is told when a cap refuses new model work. */
export const LIMIT_MESSAGES = {
  visitorMessages: `That's ${LIMITS.messagesPerVisitorPerHour} messages this hour. The Specialist needs a coffee; try again soon.`,
  dayMessages:
    "The desk has answered all the messages it takes today. Try again tomorrow.",
  ownerSpend: `Your desks have spent $${LIMITS.spendPerOwnerPerDay.toFixed(2)} on models in the last day, the demo's daily cap. Try again tomorrow.`,
  /** Only when the Owner still has room today: a new Desk then has its own cap. */
  sessionSpend: (spent: number) =>
    `This session has spent $${spent.toFixed(2)} on models, the demo's cap. Start a new desk to keep going.`,
  /** A Run refused at the Desk's cap, without the spent amount at hand. */
  sessionSpendReached: `This session has spent the demo's $${LIMITS.spendPerSession.toFixed(2)} cap on models. Start a new desk to keep going.`,
  visitorRuns: `That's ${LIMITS.runsPerVisitorPerHour} runs this hour. Give the desk a breather and try again later.`,
  dayRuns: "The desk has hit today's run limit. Try again tomorrow.",
  activeRun:
    "This desk already has a run going. Stop it or let it finish before starting another.",
};

/** The words for a refused Run. */
function runRefusalMessage(refusal: RunRefusal) {
  switch (refusal) {
    case "active":
      return LIMIT_MESSAGES.activeRun;
    case "visitor":
      return LIMIT_MESSAGES.visitorRuns;
    case "owner_spend":
      return LIMIT_MESSAGES.ownerSpend;
    case "session_spend":
      return LIMIT_MESSAGES.sessionSpendReached;
    default:
      return LIMIT_MESSAGES.dayRuns;
  }
}

const ENDED = new Set<RunRow["status"]>(["completed", "failed", "stopped"]);

function stillGoing(run: RunRow) {
  return `Run ${run.id} is ${run.status === "waiting" ? "waiting on a question" : "still running"}.`;
}

export type StartedRun = {
  runId: string;
  pipeline: PipelineId | null;
  jobs: JobId[];
  documents: { id: string; name: string }[];
};

export type Readiness = {
  ready: boolean;
  problems: string[];
  documents: { id: string; name: string }[];
  activeRunId: string | null;
  spendLeftUsd: number;
};

export type Stopped =
  | { runId: string; stopped: boolean; status: RunRow["status"] }
  | { runId: null; stopped: false };

/**
 * The Runs of a Desk: whether one could start, starting one under the caps,
 * answering its Questions, stopping it and following its events. Every
 * method takes a Desk already checked to be the caller's, and reaches only
 * that Desk's Runs; a Run of another Desk answers 404 like one that is not
 * there.
 */
export interface RunService {
  readiness(desk: SessionRow, documentIds: string[]): Promise<Readiness>;
  /**
   * Starts a Run of a pipeline, of some Jobs (plus what they depend on), or,
   * with neither, of "work it out": sort first, then infer the pipeline. The
   * caps and the one-Run rule are taken with the insert, before the workflow
   * (and its first model call) starts.
   */
  start(
    desk: SessionRow,
    input: {
      pipeline?: PipelineId | null;
      jobs?: string[];
      documentIds: string[];
    },
  ): Promise<StartedRun>;
  /** Resumes a waiting Run with the person's Answer. */
  answer(
    desk: SessionRow,
    questionId: string,
    answer: Answer,
  ): Promise<{ runId: string; alreadyAnswered: boolean }>;
  /**
   * Stops a Run: cancels its workflow, tells whoever is watching, and closes
   * its open Question. A model call already in flight still finishes and is
   * still billed; nothing after it starts.
   */
  stop(desk: SessionRow, runId: string): Promise<Stopped>;
  /** Stops whatever the Desk has going. */
  stopActive(desk: SessionRow): Promise<Stopped>;
  /** A Run of the Desk with its open Question. */
  get(
    desk: SessionRow,
    runId: string,
  ): Promise<{ run: RunRow; question: QuestionRow | null }>;
  /**
   * A Run's events from the `from`th on, for the Owner's open Desk. Resolves
   * once the Run is found to be the Desk's (404 otherwise); then the events
   * stream until the Run ends.
   */
  events(
    owner: Owner,
    rememberedId: string | null,
    runId: string,
    from: number,
  ): Promise<AsyncGenerator<RunEvent>>;
}

export type RunPorts = {
  runs: RunStore;
  cabinet: Pick<CabinetStore, "byIds">;
  desks: Pick<DeskStore, "openOf">;
  spend: Pick<SpendStore, "ofDesk" | "ofOwner">;
  workflows: RunWorkflows;
  /** The model settings a Run of the Desk uses. */
  settings: (desk: SessionRow) => Promise<ModelSettingsByPurpose>;
  now: () => number;
};

export function createRunService(ports: RunPorts): RunService {
  const { runs, workflows } = ports;
  const trusted = (desk: SessionRow) => desk.visitor_hash === E2E_VISITOR_HASH;

  /** The Run the Desk has going, if any. Runs whose workflow is long gone are closed on the way. */
  async function activeRun(deskId: string): Promise<RunRow | null> {
    const going = await runs.active(deskId);
    const now = ports.now();
    const stale = going.filter(
      (run) => now - new Date(run.created_at).getTime() > STALE_RUN_MS,
    );
    await Promise.all(
      stale.map(async (run) => {
        await runs.update(run.id, {
          status: "stopped",
          completed_at: new Date(now).toISOString(),
        });
        await runs.closeStopped(run.id);
      }),
    );
    return going.find((run) => !stale.includes(run)) ?? null;
  }

  async function ownRun(desk: SessionRow, runId: string) {
    const run = await runs.get(runId);
    if (!run || run.session_id !== desk.id)
      throw new NotFoundError("No such run");
    return run;
  }

  async function stop(run: RunRow): Promise<Stopped> {
    if (ENDED.has(run.status))
      return { runId: run.id, stopped: false, status: run.status };
    if (run.workflow_run_id) {
      // Best effort: a workflow that already ended (finished or died) throws,
      // and stopping must still close the row, or the Desk stays blocked.
      await workflows.cancel(run.workflow_run_id).catch(() => {});
      await workflows.announceStopped(run.workflow_run_id).catch(() => {});
    }
    await runs.update(run.id, {
      status: "stopped",
      completed_at: new Date(ports.now()).toISOString(),
    });
    await runs.closeStopped(run.id);
    return { runId: run.id, stopped: true, status: "stopped" };
  }

  return {
    async readiness(desk, ids) {
      const [documents, running, spend, ownerSpent] = await Promise.all([
        ports.cabinet.byIds([...new Set(ids)], desk.id),
        activeRun(desk.id),
        ports.spend.ofDesk(desk.id),
        desk.owner
          ? ports.spend.ofOwner(desk.owner, new Date(ports.now() - DAY_MS))
          : 0,
      ]);
      const spent = spend.reduce((sum, row) => sum + row.costUsd, 0);
      const found = new Set(documents.map((document) => document.id));
      const problems: string[] = [];
      if (ids.length === 0) problems.push("No documents were given.");
      const unknown = ids.filter((id) => !found.has(id));
      if (unknown.length > 0)
        problems.push(
          `${unknown.length} document id${unknown.length === 1 ? " is" : "s are"} not in the Cabinet or this desk's uploads.`,
        );
      if (documents.length > LIMITS.documentsPerRun)
        problems.push(
          `A run takes at most ${LIMITS.documentsPerRun} documents; ${documents.length} were given.`,
        );
      if (running)
        problems.push(`${stillGoing(running)} Stop it or let it finish first.`);
      if (!trusted(desk) && ownerSpent >= LIMITS.spendPerOwnerPerDay)
        problems.push("This Owner's desks have reached today's spend cap.");
      else if (!trusted(desk) && spent >= LIMITS.spendPerSession)
        problems.push("This session has reached its spend cap.");
      return {
        ready: problems.length === 0,
        problems,
        documents: documents.map((document) => ({
          id: document.id,
          name: document.name,
        })),
        activeRunId: running?.id ?? null,
        spendLeftUsd: Number(
          Math.max(
            0,
            Math.min(
              LIMITS.spendPerSession - spent,
              LIMITS.spendPerOwnerPerDay - ownerSpent,
            ),
          ).toFixed(4),
        ),
      };
    },

    async start(desk, input) {
      const [running, documents] = await Promise.all([
        activeRun(desk.id),
        ports.cabinet.byIds(
          [...new Set(input.documentIds)].slice(0, LIMITS.documentsPerRun),
          desk.id,
        ),
      ]);
      if (running)
        throw new ConflictError(
          `${stillGoing(running)} Stop it or let it finish before starting another.`,
        );
      if (documents.length === 0)
        throw new InvalidError(
          "None of those documents are in the Cabinet or this desk's uploads.",
        );
      const requested = (input.jobs ?? []).filter(isJobId);
      const pipeline = input.pipeline ?? null;
      const jobs: JobId[] = pipeline
        ? [...PIPELINES[pipeline].jobs]
        : requested.length > 0
          ? planJobs(requested)
          : ["sort"];
      const documentIds = documents.map((document) => document.id);
      // The rate limits, both spend caps and the one-Run rule are taken here,
      // with the insert, under one lock: nothing paid has started yet.
      const created = await runs.create({
        sessionId: desk.id,
        pipeline,
        jobs,
        documentIds,
        visitorHash: desk.visitor_hash,
        owner: desk.owner ?? null,
        limits: trusted(desk)
          ? null
          : {
              perVisitorPerHour: LIMITS.runsPerVisitorPerHour,
              perDay: LIMITS.runsPerDay,
              ownerSpendPerDay: LIMITS.spendPerOwnerPerDay,
              sessionSpend: LIMITS.spendPerSession,
            },
      });
      if ("refusal" in created) {
        const message = runRefusalMessage(created.refusal);
        throw created.refusal === "active"
          ? new ConflictError(message)
          : new LimitError(message);
      }
      const { runId } = created;
      try {
        const workflowRunId = await workflows.start({
          ctx: {
            runId,
            sessionId: desk.id,
            settings: await ports.settings(desk),
          },
          pipeline,
          // Hand-picked jobs never trigger pipeline inference.
          inferPipeline: !pipeline && requested.length === 0,
          jobs,
          documentIds,
        });
        await runs.update(runId, { workflow_run_id: workflowRunId });
      } catch (error) {
        await runs.update(runId, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      return {
        runId,
        pipeline,
        jobs,
        documents: documents.map((document) => ({
          id: document.id,
          name: document.name,
        })),
      };
    },

    async answer(desk, questionId, reply) {
      const question = await runs.question(questionId);
      if (!question || question.session_id !== desk.id)
        throw new NotFoundError("No such question");
      if (question.answered_at)
        return { runId: question.run_id, alreadyAnswered: true };
      // Every answered Document is sorted and read by a model: cap it like a new Run.
      const documentIds = reply.documentIds?.length
        ? (
            await ports.cabinet.byIds(
              [...new Set(reply.documentIds)].slice(0, LIMITS.documentsPerRun),
              desk.id,
            )
          ).map((document) => document.id)
        : undefined;
      await workflows.resume(question.token, {
        documentIds,
        choice: reply.choice?.slice(0, 100),
        text: reply.text?.slice(0, 500),
        skip: reply.skip,
      });
      return { runId: question.run_id, alreadyAnswered: false };
    },

    async stop(desk, runId) {
      return stop(await ownRun(desk, runId));
    },

    async stopActive(desk) {
      const running = await activeRun(desk.id);
      if (!running) return { runId: null, stopped: false };
      return stop(running);
    },

    async get(desk, runId) {
      const run = await ownRun(desk, runId);
      const [question] = await runs.openQuestions([run.id]);
      return { run, question: question ?? null };
    },

    async events(owner, rememberedId, runId, from) {
      // The Desk and the Run are read together; the Run answers only once it is the Desk's.
      const [desk, run] = await Promise.all([
        ports.desks.openOf(owner, rememberedId),
        runs.get(runId),
      ]);
      if (!desk || !run?.workflow_run_id || run.session_id !== desk.id)
        throw new NotFoundError("No such run");
      const stream = workflows.events(
        run.workflow_run_id,
        Math.max(0, Math.trunc(from)),
      );
      // A Run that is over in the database may have a stream nobody closed
      // (it was stopped, or its workflow died): its replay ends once it goes quiet.
      const over = ENDED.has(run.status);
      return (async function* () {
        const reader = stream.getReader();
        let ended = false;
        try {
          for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const idle = new Promise<"idle">((resolve) => {
              if (over) timer = setTimeout(() => resolve("idle"), IDLE_MS);
            });
            const next = await Promise.race([reader.read(), idle]);
            clearTimeout(timer);
            if (next === "idle" || next.done) {
              if (over && !ended && run.status !== "completed")
                yield {
                  at: ports.now(),
                  type: "end",
                  status: run.status === "stopped" ? "stopped" : "failed",
                  error: run.error ?? undefined,
                } satisfies RunEvent;
              return;
            }
            if (next.value.type === "end") ended = true;
            yield next.value;
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
      })();
    },
  };
}
