import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import type { StopRunResponse } from "../../domain/api";
import {
  DEFAULT_MODELS,
  type DocumentSource,
  type ExtractedName,
  type ModelChoice,
  type RunDetail,
  type RunSummary,
} from "../../domain/contract";
import { corpusCards } from "../../domain/corpus";
import { LIMITS, STALE_RUN_MS } from "../../domain/limits";
import { readFrom, startCursor, takeFresh } from "../event-cursor";
import type { SievePorts } from "../ports";
import { isOver, type RunRow, type StoredEvent, toSummary } from "../run-row";

/** Who a call is for: the Owner it is scoped to, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

/** A Run as the MCP server's `get_run` shows it. */
export type RunReport = Omit<RunSummary, "names"> & {
  names: ExtractedName[];
  events: StoredEvent[];
};

/**
 * Sieve's Runs, for the REST routes, the MCP server and the page's first
 * view alike. Every method checks the Run is the caller's Owner's; a Run that
 * is not answers 404, the same as one that does not exist.
 */
export interface RunService {
  list(owner: Owner): Promise<RunSummary[]>;
  detail(owner: Owner, runId: string): Promise<RunDetail>;
  /** The latest `events` of the Audit trail with the Register: `get_run`. */
  report(owner: Owner, runId: string, events: number): Promise<RunReport>;
  /**
   * Starts a Run under the caps (per Owner per day, per visitor per hour, a
   * few going at once per Owner), on the Owner's current Rulebook. The caps
   * are counted before the workflow, the first paid step, starts.
   */
  start(
    caller: Caller,
    input: { source: DocumentSource; models?: ModelChoice },
  ): Promise<{ runId: string }>;
  /**
   * Stops a Run. The row is closed first and always; the workflow cancel and
   * the Sandbox stop are best effort (conventions.md, "Make the escape hatch
   * work when the thing it escapes is broken").
   */
  stop(owner: Owner, runId: string): Promise<StopRunResponse>;
  /**
   * The Audit trail from `after`, live: resolves once the Run is found to be
   * the Owner's (a 404 before the first line otherwise), then yields each
   * event until `end`, or for about 280 s (the client reconnects).
   */
  follow(
    owner: Owner,
    runId: string,
    after: number,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<StoredEvent>>;
}

const POLL_MS = 700;
/** Ends the stream before the platform does, so the client reconnects cleanly. */
const OPEN_MS = 280_000;
/** Polls a Run seen over waits for its own `end` before the stream writes one. */
const OVER_GRACE_POLLS = 3;
/** Reads per poll; more than EVENT_OVERLAP so a full page always moves the cursor. */
const PAGE = 500;
const NO_RUN = "No such run.";

/** While a Run goes, its Register is its latest `names` event; once over, the stored one. */
function registerOf(run: RunRow, events: StoredEvent[]): ExtractedName[] {
  const stored = Array.isArray(run.names) ? run.names : [];
  if (isOver(run.status) && stored.length > 0) return stored;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type === "names") return event.names;
  }
  return stored;
}

export function createRunService(
  ports: Pick<
    SievePorts,
    | "runs"
    | "events"
    | "rulebooks"
    | "uploads"
    | "workflows"
    | "sandbox"
    | "now"
    | "wait"
  >,
): RunService {
  const { runs, events } = ports;

  /** Closes a Run whose workflow is long gone, so it stops counting as active. */
  async function closeIfStale(run: RunRow): Promise<RunRow> {
    if (isOver(run.status)) return run;
    if (ports.now() - Date.parse(run.started_at) < STALE_RUN_MS) return run;
    const error = "The run lost its workflow and was closed.";
    if (!(await runs.endIfGoing(run.id, { status: "failed", error }))) {
      // It ended meanwhile, with its own `end`: read what it ended as.
      return (await runs.get(run.id)) ?? run;
    }
    await events
      .append(run.id, [{ type: "end", status: "failed", error }])
      .catch(() => {});
    return {
      ...run,
      status: "failed",
      error,
      ended_at: new Date(ports.now()).toISOString(),
    };
  }

  /** The Owner's Run with its whole trail, read together; 404 if it is not theirs. */
  async function ownedWithEvents(owner: Owner, runId: string) {
    // The trail is read alongside the Owner check and thrown away if the
    // check fails, so another Owner's id costs a round trip, never a leak.
    const [found, trail] = await Promise.all([
      runs.owned(owner, runId),
      events.all(runId).catch(() => null),
    ]);
    if (!found) throw new NotFoundError(NO_RUN);
    const run = await closeIfStale(found);
    // A stale close appended an `end`; read the trail again only then.
    const all =
      trail === null || run !== found ? await events.all(run.id) : trail;
    return { run, events: all };
  }

  async function describe(owner: Owner, source: DocumentSource) {
    if (source.kind === "corpus") {
      const card = corpusCards().find((item) => item.id === source.corpusId);
      if (!card) throw new NotFoundError("No such Corpus Document.");
      return { title: card.title, pages: card.pages };
    }
    const upload = await ports.uploads.owned(owner, source.uploadId);
    if (!upload) throw new NotFoundError("No such upload.");
    return { title: upload.title, pages: upload.pages };
  }

  async function* stream(
    run: RunRow,
    given: number,
    signal: AbortSignal,
  ): AsyncGenerator<StoredEvent> {
    let cursor = startCursor(given);
    const opened = ports.now();
    // The workflow ends the row first and writes `end` after it, so a Run
    // seen over with nothing new gets a few more polls for that `end`.
    let overPolls = 0;
    while (!signal.aborted && ports.now() - opened < OPEN_MS) {
      const page = await events.after(run.id, readFrom(cursor), PAGE);
      const taken = takeFresh(cursor, page);
      cursor = taken.cursor;
      for (const event of taken.fresh) {
        yield event;
        if (event.type === "end") return;
      }
      if (page.length === PAGE) continue;
      if (taken.fresh.length === 0) {
        // A Run that is over but never wrote `end` (its workflow died) stops here.
        const latest = await runs.get(run.id);
        if (!latest || isOver(latest.status)) {
          if (overPolls < OVER_GRACE_POLLS) {
            overPolls += 1;
          } else {
            // Same seq as the last event sent: the client takes an `end` it
            // has not seen even when the seq is not new (run-view.ts).
            if (latest)
              yield {
                seq: cursor.after,
                at: ports.now(),
                type: "end",
                status: latest.status as "completed" | "failed" | "stopped",
                ...(latest.error ? { error: latest.error } : {}),
                ...(latest.score ? { score: latest.score } : {}),
                ...(typeof latest.gate_passed === "boolean"
                  ? { gatePassed: latest.gate_passed }
                  : {}),
                ...(latest.stopped_by ? { stoppedBy: latest.stopped_by } : {}),
              };
            return;
          }
        }
      }
      await ports.wait(POLL_MS, signal);
    }
  }

  return {
    async list(owner) {
      const rows = await runs.list(owner, 50);
      return (await Promise.all(rows.map(closeIfStale))).map(toSummary);
    },

    async detail(owner, runId) {
      const { run, events: trail } = await ownedWithEvents(owner, runId);
      // The detail carries the list in place of the summary's count.
      const { names: _count, ...summary } = toSummary(run);
      return { ...summary, events: trail, names: registerOf(run, trail) };
    },

    async report(owner, runId, count) {
      const { run, events: trail } = await ownedWithEvents(owner, runId);
      return {
        ...toSummary(run),
        names: registerOf(run, trail),
        events: count > 0 ? trail.slice(-count) : [],
      };
    },

    async start(caller, input) {
      const { owner, visitor } = caller;
      const [described, rulebook] = await Promise.all([
        describe(owner, input.source),
        ports.rulebooks.current(owner),
      ]);
      if (described.pages < 1 || described.pages > LIMITS.maxPages)
        throw new InvalidError(`A Document has 1 to ${LIMITS.maxPages} pages.`);
      const models = input.models ?? DEFAULT_MODELS;
      const created = await runs.create({
        owner,
        visitorHash: visitor.hash,
        title: described.title,
        pages: described.pages,
        source: input.source,
        models,
        rulebookVersion: rulebook.version,
        rulebook: rulebook.rulebook,
        limits: visitor.trusted
          ? null
          : {
              perOwnerPerDay: LIMITS.runsPerOwnerPerDay,
              perVisitorPerHour: LIMITS.runsPerVisitorPerHour,
              activePerOwner: LIMITS.activePerOwner,
            },
      });
      if ("refusal" in created) throw new LimitError(created.refusal);
      const { runId } = created;
      try {
        const workflowRunId = await ports.workflows.start({
          runId,
          source: input.source,
          title: described.title,
          pages: described.pages,
          models,
          rulebook: rulebook.rulebook,
          rulebookVersion: rulebook.version,
        });
        await runs.setWorkflow(runId, workflowRunId);
      } catch (error) {
        console.error("[name-extraction] workflow start failed", error);
        const message = error instanceof Error ? error.message : String(error);
        if (await runs.endIfGoing(runId, { status: "failed", error: message }))
          await events
            .append(runId, [{ type: "end", status: "failed", error: message }])
            .catch(() => {});
        throw new ConflictError("The run could not be started. Try again.");
      }
      return { runId };
    },

    async stop(owner, runId) {
      const run = await runs.owned(owner, runId);
      if (!run) throw new NotFoundError(NO_RUN);
      if (isOver(run.status))
        return { runId: run.id, stopped: false, status: run.status };
      if (!(await runs.endIfGoing(run.id, { status: "stopped" }))) {
        // It ended on its own between the read and the stop, and wrote its own `end`.
        const latest = await runs.get(run.id);
        return {
          runId: run.id,
          stopped: false,
          status: latest?.status ?? run.status,
        };
      }
      await events
        .append(run.id, [
          { type: "log", level: "warn", text: "■ stopped by its Owner" },
          { type: "end", status: "stopped" },
        ])
        .catch(() => {
          // The events stream ends the trail of a stopped Run by itself.
        });
      if (run.workflow_run_id) {
        try {
          await ports.workflows.cancel(run.workflow_run_id);
        } catch {
          // Already ended, or the workflow is gone: the row is closed either way.
        }
      }
      await ports.sandbox.dispose(run.id);
      return { runId: run.id, stopped: true, status: "stopped" };
    },

    async follow(owner, runId, after, signal) {
      const run = await runs.owned(owner, runId);
      if (!run) throw new NotFoundError(NO_RUN);
      return stream(run, after, signal);
    },
  };
}
