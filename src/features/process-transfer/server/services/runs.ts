import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import { AUDIT_PAGE, type AuditQuery } from "../../domain/api";
import { exportRefusal } from "../../domain/approval";
import {
  redoProblem,
  spendView,
  type WorkCounts,
  workProblem,
} from "../../domain/caps";
import { LIMITS, type UploadType } from "../../domain/limits";
import {
  type AuditEvent,
  type DeskView,
  type ExportKind,
  freshStages,
  isOver,
  type RunEvent,
  type RunView,
  type StageState,
  type StartInput,
  type UploadTicket,
} from "../../domain/run";
import { sampleBySlug } from "../../domain/samples";
import {
  displayName,
  ownerPrefix,
  ownRecordingType,
  recordingPath,
  uploadProblem,
} from "../../domain/uploads";
import type {
  AuditLog,
  RecordingSource,
  RecordingStore,
  RunRepository,
  RunWorkflows,
} from "../ports";
import { type ActiveRun, type RunRow, toRunView } from "../run-row";
import type { SettingsService } from "./settings";

/** Who a call is for: the Owner whose Runs it may touch, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

/** The message a person sees when the one-active-Run gate refuses. */
export const ACTIVE_RUN_MESSAGE =
  "A Run is still going. Stop it or let it finish before starting another.";

const NO_SUCH_RUN = "There is no such Run.";

/** A Run (or Redo) that still claims to be going after this has lost its workflow. */
const STALE_RUN_MS = 30 * 60_000;

/** How long a finished Run's stream may go quiet before its replay ends by itself. */
const IDLE_MS = 2500;

/**
 * Everything a person does with Runs. Every read and write by id is scoped
 * to the caller's Owner, and every path that adds paid work (a Run, a Redo,
 * an upload that would start one) checks the caps first.
 */
export interface RunService {
  /** Everything the Desk opens with, read together. */
  desk(caller: Caller): Promise<DeskView>;
  /** One of the Owner's Runs; NotFound for anyone else's. */
  run(owner: Owner, runId: string | null): Promise<RunView>;
  /** A page of the Owner's Audit trail, newest first, optionally one Run's. */
  audit(owner: Owner, query: AuditQuery): Promise<AuditEvent[]>;
  prepareUpload(
    caller: Caller,
    file: { name: string; size: number; type: string },
  ): Promise<UploadTicket>;
  /** Starts a Run; `host` is the request's, for where a Sample is fetched from. */
  start(caller: Caller, input: StartInput, host: string): Promise<string>;
  stop(owner: Owner, runId: string | null): Promise<void>;
  redo(caller: Caller, runId: string | null): Promise<string>;
  /** Writes a download to the Audit trail; refused unless the file may be had. */
  recordExport(
    owner: Owner,
    runId: string | null,
    kind: ExportKind,
  ): Promise<void>;
  /** Resolves once the Run is the Owner's; then its events stream from `from`. */
  events(
    owner: Owner,
    runId: string | null,
    from: number,
  ): Promise<AsyncGenerator<RunEvent>>;
}

export type RunPorts = {
  runs: RunRepository;
  settings: Pick<SettingsService, "current">;
  audit: AuditLog;
  store: RecordingStore;
  workflows: RunWorkflows;
  /** The site a Sample may be fetched from for this Host header, or null when none can be trusted. */
  origin: (host: string) => string | null;
  newId: () => string;
  now: () => number;
};

export function createRunService(ports: RunPorts): RunService {
  const { runs, settings, audit, store, workflows } = ports;

  async function owned(owner: Owner, runId: string | null): Promise<RunRow> {
    const row = runId ? await runs.owned(owner, runId) : null;
    if (!row) throw new NotFoundError(NO_SUCH_RUN);
    return row;
  }

  /** The Owner's Run that is still going. Runs whose workflow died long ago are closed on the way. */
  async function activeRun(owner: Owner): Promise<ActiveRun | null> {
    let live: ActiveRun | null = null;
    for (const run of await runs.active(owner)) {
      if (ports.now() - run.started_at.getTime() > STALE_RUN_MS) {
        const reason = "The pipeline stopped responding.";
        const ended = await runs.markStopped(run.id, owner, reason, "failed");
        if (ended) {
          await audit.pipeline({
            owner,
            action: "run.failed",
            runId: run.id,
            summary: `"${run.title}" failed: ${reason}`,
            detail: { stale: true },
          });
        }
      } else {
        live ??= run;
      }
    }
    return live;
  }

  async function workCounts(
    owner: Owner,
    visitor: Visitor,
    running: Promise<ActiveRun | null> = activeRun(owner),
  ): Promise<WorkCounts> {
    const [active, totals] = await Promise.all([
      running,
      runs.workTotals(owner, visitor.hash),
    ]);
    return { activeRunId: active?.id ?? null, ...totals };
  }

  /** Throws when new paid work is refused: a Run still going (409), or a cap (429). */
  async function checkWork(caller: Caller) {
    const counts = await workCounts(caller.owner, caller.visitor);
    const problem = workProblem(counts, { trusted: caller.visitor.trusted });
    if (!problem) return;
    if (counts.activeRunId) throw new ConflictError(problem);
    throw new LimitError(problem);
  }

  function activeConflict(error: unknown): never {
    // Two starts raced past the check; the unique index let one through.
    if (runs.isActiveRunConflict(error))
      throw new ConflictError(ACTIVE_RUN_MESSAGE);
    throw error;
  }

  async function startWorkflow(
    runId: string,
    owner: Owner,
    mode: "full" | "redo",
    origin: string,
    generation: number,
  ) {
    try {
      const workflowRunId = await workflows.start({
        runId,
        owner,
        mode,
        origin,
        generation,
      });
      await runs.setFields(runId, { workflow_run_id: workflowRunId });
    } catch (error) {
      await runs.setFields(runId, {
        status: "failed",
        error: "The pipeline could not start. Try again.",
        completed_at: new Date(ports.now()),
      });
      throw error;
    }
  }

  async function signedOrNull(path: string): Promise<string | null> {
    return store.signedUrl(path).catch(() => null);
  }

  async function* follow(row: RunRow, from: number): AsyncGenerator<RunEvent> {
    if (!row.workflow_run_id) return;
    const reader = workflows.events(row.workflow_run_id, from).getReader();
    // A Run that is over in the database may have a stream nobody closed (it
    // was stopped, or its workflow died). Its replay ends once it goes quiet.
    const over = isOver(row.status);
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
          if (over && !ended && row.status !== "completed") {
            yield {
              at: ports.now(),
              type: "end",
              status: row.status === "stopped" ? "stopped" : "failed",
            };
          }
          return;
        }
        if (next.value.type === "end") ended = true;
        yield next.value;
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  }

  return {
    async desk({ owner, visitor }) {
      const running = activeRun(owner);
      // The gate's one stale sweep serves both the counts and the Desk.
      running.catch(() => {});
      const [list, current, counts, active] = await Promise.all([
        runs.list(owner),
        settings.current(owner),
        workCounts(owner, visitor, running),
        running,
      ]);
      return {
        runs: list,
        rules: current.rules,
        ruleOverrides: current.ruleOverrides,
        rulesVersion: current.rulesVersion,
        models: current.models,
        spend: spendView(counts),
        activeRunId: active?.id ?? null,
        limits: {
          uploadBytes: LIMITS.uploadBytes,
          uploadSeconds: LIMITS.uploadSeconds,
        },
      };
    },

    async run(owner, runId) {
      const found = runId ? await runs.ownedWithCalls(owner, runId) : null;
      if (!found) throw new NotFoundError(NO_SUCH_RUN);
      const { row, calls } = found;
      const video =
        row.source_kind === "sample"
          ? (sampleBySlug(row.sample_slug ?? "")?.video ?? null)
          : row.recording_path
            ? await signedOrNull(row.recording_path)
            : null;
      return toRunView(row, calls, video);
    },

    // The lines are the Owner's by `owner`, so another Owner's Run id finds none.
    audit: (owner, query) =>
      audit.list(owner, {
        before: query.before,
        runId: query.runId,
        limit: AUDIT_PAGE,
      }),

    async prepareUpload(caller, file) {
      const problem = uploadProblem(file);
      if (problem) throw new InvalidError(problem);
      // An upload is only worth making when a Run could start with it.
      await checkWork(caller);
      const uploaded = await store.uploadsSince(
        ownerPrefix(caller.owner),
        new Date(ports.now() - 86_400_000),
      );
      if (uploaded >= LIMITS.uploadsPerOwnerPerDay) {
        throw new LimitError(
          `That's ${LIMITS.uploadsPerOwnerPerDay} uploads today. Try a sample, or upload again tomorrow.`,
        );
      }
      const path = recordingPath(
        caller.owner,
        file.type as UploadType,
        ports.newId(),
      );
      return { path, signedUrl: await store.uploadUrl(path) };
    },

    async start(caller, input, host) {
      const { owner, visitor } = caller;
      let source: RecordingSource;
      let title: string;
      if (input.kind === "sample") {
        const sample = sampleBySlug(input.slug);
        if (!sample) throw new InvalidError("That sample is not available.");
        source = { kind: "sample", slug: sample.slug };
        title = sample.title;
      } else {
        const type = ownRecordingType(owner, input.path);
        if (!type) throw new InvalidError("That upload is not yours.");
        const name = displayName(input.name);
        source = { kind: "upload", path: input.path, name, type };
        title = name;
      }
      await checkWork(caller);
      if (source.kind === "upload") {
        const size = await store.objectSize(source.path);
        if (size === null) {
          throw new InvalidError(
            "The upload has not arrived. Upload it again.",
          );
        }
        if (size > LIMITS.uploadBytes) {
          throw new InvalidError(
            "That Recording is larger than the demo takes.",
          );
        }
      }
      let origin = "";
      if (source.kind === "sample") {
        const trusted = ports.origin(host);
        if (!trusted) {
          throw new InvalidError(
            "This deployment cannot fetch its own samples.",
          );
        }
        origin = trusted;
      }
      const current = await settings.current(owner);
      const runId = await runs
        .create({
          owner,
          visitorHash: visitor.hash,
          source,
          title,
          stages: freshStages(),
          rules: current.rules,
          rulesVersion: current.rulesVersion,
          models: current.models,
        })
        .catch(activeConflict);
      await audit.person({
        owner,
        action: "run.started",
        runId,
        summary: `Started a Run on ${source.kind === "sample" ? `the sample "${title}"` : `"${title}"`} with Rules v${current.rulesVersion}`,
        detail: {
          source: source.kind,
          sample: source.kind === "sample" ? source.slug : null,
          rulesVersion: current.rulesVersion,
          models: current.models,
        },
        visitorHash: visitor.hash,
      });
      if (source.kind === "upload") {
        await audit.person({
          owner,
          action: "recording.uploaded",
          runId,
          summary: `Uploaded "${title}"`,
          detail: { type: source.type },
        });
      }
      await startWorkflow(runId, owner, "full", origin, 0);
      return runId;
    },

    /*
     * The row is marked first and always: the Run that most needs stopping
     * is the one whose workflow already died. Cancelling the workflow and
     * ending its stream are best effort. A model call already in flight
     * still finishes and its cost is still added to the Run.
     */
    async stop(owner, runId) {
      const run = await owned(owner, runId);
      const stopped = await runs.markStopped(run.id, owner);
      if (!stopped) return;
      if (run.workflow_run_id) {
        try {
          await workflows.cancel(run.workflow_run_id);
        } catch {
          // Already ended; the row is what counts.
        }
        try {
          // The screen gets the stopped row's stages and status at once.
          await workflows.announceStopped(run.workflow_run_id, {
            status: "stopped",
            stages: stopped.stages,
            error: stopped.error,
            completedAt: stopped.completed_at?.toISOString() ?? null,
          });
        } catch {
          // The events route ends a stopped Run's stream by itself.
        }
      }
      await audit.person({
        owner,
        action: "run.stopped",
        runId: run.id,
        summary: `Stopped "${run.title}"`,
      });
    },

    async redo(caller, runId) {
      const { owner, visitor } = caller;
      const run = await owned(owner, runId);
      const problem = redoProblem({
        status: run.status,
        hasProcess: run.process !== null,
        verified: run.stages.some(
          (stage) => stage.id === "verify" && stage.status === "done",
        ),
        redos: run.redos,
      });
      if (problem) throw new ConflictError(problem);
      await checkWork(caller);
      const current = await settings.current(owner);
      const stages: StageState[] = run.stages.map((stage) =>
        // Document has no model and is laid out again with the Deck, so a Run
        // stopped before it gets it on the Redo.
        stage.id === "document" ||
        stage.id === "design" ||
        stage.id === "check" ||
        stage.id === "approve"
          ? { ...stage, status: "pending", summary: null, ms: null }
          : stage,
      );
      const generation = await runs
        .resetForRedo({
          id: run.id,
          owner,
          stages,
          rules: current.rules,
          rulesVersion: current.rulesVersion,
          models: current.models,
        })
        .catch(activeConflict);
      if (generation === null) {
        throw new ConflictError("The Run changed; reload and try again.");
      }
      await audit.person({
        owner,
        action: "deck.redone",
        runId: run.id,
        summary: `Redid the Deck of "${run.title}" under Rules v${current.rulesVersion} (was v${run.rules_version})`,
        detail: {
          redo: generation,
          rulesVersion: current.rulesVersion,
          previousRulesVersion: run.rules_version,
          previousApproval: run.approval?.status ?? null,
          models: current.models,
        },
        visitorHash: visitor.hash,
      });
      await startWorkflow(run.id, owner, "redo", "", generation);
      return run.id;
    },

    async recordExport(owner, runId, kind) {
      const run = await owned(owner, runId);
      const refusal = exportRefusal(kind, {
        hasProcess: run.process !== null,
        approval: run.approval?.status ?? null,
      });
      if (refusal) throw new ConflictError(refusal);
      const round = run.rounds.at(-1)?.round ?? null;
      await audit.person({
        owner,
        action: "export.downloaded",
        runId: run.id,
        summary:
          kind === "pptx"
            ? `Downloaded the Deck of "${run.title}" (round ${round}) as PPTX`
            : `Downloaded the workflow document of "${run.title}" as DOCX`,
        detail: { kind, round, rulesVersion: run.rules_version },
      });
    },

    async events(owner, runId, from) {
      const run = await owned(owner, runId);
      if (!run.workflow_run_id) throw new NotFoundError(NO_SUCH_RUN);
      return follow(run, from);
    },
  };
}
