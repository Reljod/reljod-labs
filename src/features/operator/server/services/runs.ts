import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import {
  readFrom,
  startCursor,
  takeFresh,
} from "@/features/name-extraction/server/event-cursor";
import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { Visitor } from "@/platform/request/visitor";
import { evaluate } from "../../domain/checks";
import {
  DEFAULT_MODEL,
  EMPTY_METRICS,
  type HandInput,
  isOver,
  type ModelId,
  type RunDetail,
  type RunEvent,
  type RunEventInput,
  type RunStatus,
  type RunSummary,
  type TaskRef,
} from "../../domain/contract";
import { LIMITS, STALE_RUN_MS } from "../../domain/limits";
import { parseManifest } from "../../domain/manifest";
import { OWN_SIGN_ON } from "../../domain/task-cards";
import { sampleTask } from "../../domain/tasks";
import { diffBooks } from "../../legacy/books";
import { inputsOf } from "../../legacy/input";
import { boot, step } from "../../legacy/machine";
import type { ScreenCode } from "../../legacy/types";
import {
  type Counters,
  contextOf,
  countersOf,
  expectedOf,
  type RunContext,
} from "../context";
import { ScreenUnavailable } from "../errors";
import type { ToolCall } from "../operator";
import type {
  ApprovalStore,
  FrameStore,
  ManifestStore,
  RulebookStore,
  RunStore,
  RunWorkflow,
  ScreenPort,
  TrailStore,
} from "../ports";
import { type RunRow, runRulebook, toSummary } from "../repository";
import { frameHint, type RunStepsService } from "./steps";
import { createTrail } from "./trail";

/*
 * Starting, stopping, deciding and reading Runs, for the REST routes, the
 * MCP tools and the page alike: all call these, so the caps, the Rules and
 * the Trail are the same whichever way a request comes in (ADR 0025). Every
 * method takes the Owner the gate gave its caller and touches only their Runs.
 */

/** Who a call is for: the Owner whose Runs it may touch, the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

export type RunsPorts = {
  runs: RunStore;
  trail: TrailStore;
  approvals: Pick<ApprovalStore, "decide" | "expirePending" | "pausedMs">;
  rulebooks: Pick<RulebookStore, "current">;
  manifests: Pick<ManifestStore, "owned">;
  frames: Pick<FrameStore, "get">;
  screen: Pick<ScreenPort, "available">;
  workflow: RunWorkflow;
  steps: RunStepsService;
  /** The stubbed e2e suite: its Runs are marked so their steps get the stub adapters too. */
  stub: boolean;
  now: () => number;
};

/**
 * How long a client-driven start may spend booting its Screen: below the MCP
 * route's `maxDuration` (300 s), with room for the base to be built first.
 */
export const CLIENT_BOOT_MS = 240_000;

/** The work's answer, or a ScreenUnavailable once `ms` have passed. The work itself is not cancelled. */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ScreenUnavailable(`no Screen after ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** A fixed start for a replay, so the session timeout depends only on the gaps between inputs. */
const HAND_EPOCH = Date.UTC(2026, 10, 19, 8, 0, 0);

/** Frames no Run can have: one per Action, the sign-on Frame and a look after each pause. */
const MAX_FRAME = LIMITS.actionsPerRun + LIMITS.turnsPerRun;

// The event stream's pacing.
const POLL_MS = 500;
/** Ends the stream before the platform does, so the client reconnects cleanly. */
const OPEN_MS = 280_000;
/** Polls a Run seen over waits for its own `end` before the stream writes one. */
const OVER_GRACE_POLLS = 3;
const PAGE = 500;
/** With no new events, the Run's row is read on every this many polls (about 2 s). */
const ROW_EVERY = 4;

/** The most of a Trail one read returns: more than any Run writes under its caps. */
const WHOLE_TRAIL = 5000;

const isId = (value: string) => z.uuid().safeParse(value).success;

const noSuchRun = () => new NotFoundError("No such Run.");

export type StartInput = {
  task: TaskRef;
  manifestId?: string | null;
  model?: ModelId;
  driver: "operator" | "client";
};

export type HandAttempt = {
  taskId: string;
  inputs: HandInput[];
  elapsedMs: number;
};

export type ClientCallResult = {
  text: string;
  /** The Frame to show the client, when the call took one. */
  frame: number | null;
  finished: boolean;
};

export interface RunsService {
  /** The Owner's Runs, newest first; a Run that lost its workflow is closed on the way. */
  list(owner: Owner): Promise<RunSummary[]>;
  /** One of the Owner's Runs with its Trail and Findings. */
  detail(owner: Owner, runId: string): Promise<RunDetail>;
  /** A page of a Run's Trail after `after`. */
  trail(
    owner: Owner,
    runId: string,
    after: number,
  ): Promise<{ events: RunEvent[]; more: boolean }>;
  /** The picture of one Frame (PNG). */
  frame(owner: Owner, runId: string, n: number): Promise<Buffer>;
  /**
   * Resolves once the Run is found to be the Owner's; then streams its Trail
   * after `after`, ending after `end` or after about 280 s (resume with `after`).
   */
  follow(
    owner: Owner,
    runId: string,
    after: number,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<RunEvent>>;
  /**
   * Starts a Run under the caps and the Owner's current Rulebook (snapshotted
   * on the Run). `operator`: a workflow drives it. `client`: the Screen boots
   * here and the caller drives it with the screen tools.
   */
  start(caller: Caller, input: StartInput): Promise<{ runId: string }>;
  /** Stops a Run. The local state change comes first and always happens. */
  stop(
    owner: Owner,
    runId: string,
  ): Promise<{ runId: string; stopped: boolean; status: RunStatus }>;
  /**
   * A decision on a paused Action. `by: "client"` is an MCP caller: it may
   * decide for a Run the Operator drives, never for one it drives itself.
   */
  decide(input: {
    owner: Owner;
    runId: string;
    approvalId: string;
    decision: "approved" | "refused";
    by: "person" | "client";
  }): Promise<{ ok: true }>;
  /** One tool call of a client-driven Run, through the same steps as the workflow's. */
  clientCall(
    owner: Owner,
    runId: string,
    toolName: string,
    input: unknown,
  ): Promise<ClientCallResult>;
  /** Files a "take the keyboard" attempt: replayed and checked by the server. */
  fileHand(caller: Caller, attempt: HandAttempt): Promise<{ runId: string }>;
}

type Resolved = {
  taskId: string | null;
  title: string;
  brief: string;
  manifestId: string | null;
  manifest: RunContext["manifest"];
};

const limitsFor = (visitor: Visitor, hand = false) =>
  visitor.trusted
    ? null
    : {
        perVisitorPerHour: hand
          ? LIMITS.handRunsPerVisitorPerHour
          : LIMITS.runsPerVisitorPerHour,
        perOwnerPerDay: LIMITS.runsPerOwnerPerDay,
        activePerOwner: LIMITS.activePerOwner,
      };

export function createRunsService(ports: RunsPorts): RunsService {
  const { runs, approvals, steps } = ports;
  const { emit } = createTrail(ports.trail);

  /** Closes a Run whose workflow or driver is long gone, so it stops counting as active. */
  async function closeIfStale(run: RunRow): Promise<RunRow> {
    if (isOver(run.status)) return run;
    if (ports.now() - run.started_at.getTime() < STALE_RUN_MS) return run;
    const error = "The Run ran out of time and was closed.";
    if (!(await runs.endIfGoing(run.id, { status: "failed", error })))
      return (await runs.get(run.id)) ?? run;
    await ports.trail
      .append(run.id, [{ type: "end", status: "failed", error }])
      .catch(() => {});
    await approvals.expirePending(run.id).catch(() => {});
    await steps.dispose(run.id);
    return {
      ...run,
      status: "failed",
      error,
      ended_at: new Date(ports.now()),
      pending: null,
    };
  }

  async function owned(owner: Owner, runId: string) {
    const found = isId(runId) ? await runs.owned(owner, runId) : null;
    if (!found) throw noSuchRun();
    return found;
  }

  /** What a Run is asked to do, checked against the Owner: the Task and its Manifest. */
  async function resolveTask(
    owner: Owner,
    task: TaskRef,
    manifestId: string | null,
  ): Promise<Resolved> {
    let manifest: RunContext["manifest"] = null;
    let attached: string | null = null;
    if (manifestId) {
      const row = await ports.manifests.owned(owner, manifestId);
      if (!row || row.status !== "read" || !row.parsed || row.body === null)
        throw new NotFoundError("No such Manifest. Attach it again.");
      attached = row.id;
      manifest = {
        name: row.name,
        text: row.body,
        voyage: row.parsed.voyage,
        lines: row.parsed.lines,
      };
    }
    if (task.kind === "sample") {
      const sample = sampleTask(task.taskId);
      if (!sample) throw new InvalidError("No such sample Task.");
      if (!manifest && sample.manifest) {
        const parsed = parseManifest(sample.manifest.text);
        manifest = {
          name: sample.manifest.name,
          text: sample.manifest.text,
          voyage: parsed.voyage,
          lines: parsed.lines,
        };
      }
      return {
        taskId: sample.id,
        title: sample.title,
        brief: sample.brief,
        manifestId: attached,
        manifest,
      };
    }
    const words = task.brief.replace(/\p{Cc}+/gu, " ").trim();
    if (words.length < 12)
      throw new InvalidError(
        "Say what the Operator should do, in a sentence or two.",
      );
    if (words.length > LIMITS.taskChars)
      throw new InvalidError(
        `A Task is at most ${LIMITS.taskChars} characters.`,
      );
    return {
      taskId: null,
      title: words.length > 70 ? `${words.slice(0, 67)}...` : words,
      brief: `${OWN_SIGN_ON}\n${words}`,
      manifestId: attached,
      manifest,
    };
  }

  /** The context of a Run on its row, with its Manifest loaded again. */
  async function loadContext(owner: Owner, row: RunRow): Promise<RunContext> {
    const manifest = await resolveTask(
      owner,
      row.task_id
        ? { kind: "sample", taskId: row.task_id }
        : { kind: "own", brief: row.brief },
      row.manifest_id,
    ).then(
      (resolved) => resolved.manifest,
      () => null,
    );
    return contextOf(row, manifest);
  }

  async function failStart(runId: string, error: unknown): Promise<never> {
    const shown =
      error instanceof ScreenUnavailable
        ? error.message
        : "The Run could not be started.";
    if (!(error instanceof ScreenUnavailable))
      console.error("[operator] start failed", error);
    if (await runs.endIfGoing(runId, { status: "failed", error: shown }))
      await ports.trail
        .append(runId, [{ type: "end", status: "failed", error: shown }])
        .catch(() => {});
    await steps.dispose(runId);
    throw new ConflictError(`${shown} Try again.`);
  }

  /**
   * A client-driven Run has no workflow to expire its Approval, so the
   * harness does it on the next call or decision that touches the Run: the
   * change is refused, the Run goes back to running, and the Trail says so.
   * True when it expired the Approval here.
   */
  async function expireIfLate(owner: Owner, run: RunRow): Promise<boolean> {
    const pending = run.pending;
    if (run.driver !== "client" || run.status !== "paused" || !pending)
      return false;
    if (pending.expiresAt > ports.now()) return false;
    const expired = await approvals.decide(
      run.id,
      pending.approvalId,
      "expired",
    );
    // Decided by a person a moment ago: their decision stands.
    if (!expired) return false;
    try {
      await steps.settle(
        await loadContext(owner, run),
        expired.id,
        expired.fingerprint,
        null,
      );
    } catch (error) {
      // The Screen is gone: the next call finds that and closes the Run.
      console.error("[operator] settle after expiry failed", error);
    }
    return true;
  }

  /** The body of a client call, run only while the call holds its Run. */
  async function claimedCall(
    owner: Owner,
    runId: string,
    toolName: string,
    input: unknown,
    note: string,
  ): Promise<ClientCallResult> {
    // Read again under the claim: the counters the call before this one saved.
    const run = await runs.get(runId);
    if (!run || run.status !== "running")
      throw new ConflictError(`The Run is ${run?.status ?? "gone"}.`);
    const ctx = await loadContext(owner, run);
    let counters: Counters = countersOf(run);
    const startedAt = run.started_at.getTime();
    try {
      // Time spent waiting for a person is the harness's, not the client's.
      const pausedMs = await approvals.pausedMs(run.id);
      if (
        ports.now() - startedAt - pausedMs >
        (LIMITS.sandboxMinutes - 1) * 60_000
      ) {
        await steps.finish(
          ctx,
          counters,
          { status: "completed", stoppedBy: "time" },
          startedAt,
        );
        throw new ConflictError(
          "The Run reached its time limit and was closed; the Books were checked.",
        );
      }
      const call: ToolCall = {
        toolCallId: `client-${counters.turns + 1}`,
        toolName,
        input,
      };
      const keyed = toolName === "run_code" ? await steps.keyed(ctx) : [];
      counters = { ...counters, turns: counters.turns + 1 };
      const done = await steps.runCall(
        ctx,
        counters,
        { turn: counters.turns, intent: "" },
        call,
        keyed,
      );
      counters = done.counters;
      let text = done.output;
      if (done.outcome?.blocked?.decision.kind === "pause") {
        const opened = await steps.openApproval(
          ctx,
          counters,
          done.outcome,
          null,
        );
        if (opened) {
          counters = opened.counters;
          text = `${done.output} The Run is paused. A person must approve or refuse it in the app (Approval ${opened.pending.approvalId}); you cannot. Once approved, send the same Action again${done.outcome.blocked.applied > 0 ? `, without the ${done.outcome.blocked.applied} input(s) already applied` : ""}.`;
        }
      }
      if (done.finished !== undefined) {
        await steps.finish(
          ctx,
          counters,
          { status: "completed", stoppedBy: "finish", summary: done.finished },
          startedAt,
        );
        return {
          text: `${note}Finished. Code checked the Books: call get_run for the Verdict and Findings.`,
          frame: null,
          finished: true,
        };
      }
      await steps.saveCounters(ctx, counters);
      if (done.hint) text = `${text} (${done.hint})`;
      return { text: `${note}${text}`, frame: done.frame, finished: false };
    } catch (error) {
      if (error instanceof ScreenUnavailable) {
        await steps.finish(
          ctx,
          counters,
          { status: "failed", error: error.message },
          startedAt,
        );
        throw new ConflictError(`${error.message} The Run was closed.`);
      }
      throw error;
    }
  }

  async function* stream(
    runId: string,
    after: number,
    signal: AbortSignal,
  ): AsyncGenerator<RunEvent> {
    let cursor = startCursor(after);
    const opened = ports.now();
    let overPolls = 0;
    let emptyPolls = 0;
    while (!signal.aborted && ports.now() - opened < OPEN_MS) {
      const page = await ports.trail.after(runId, readFrom(cursor), PAGE);
      const taken = takeFresh(cursor, page);
      cursor = taken.cursor;
      for (const event of taken.fresh) {
        yield event;
        if (event.type === "end") return;
      }
      if (page.length === PAGE) continue;
      if (taken.fresh.length > 0) emptyPolls = 0;
      else emptyPolls += 1;
      // A quiet stream (a Run waiting for a person) reads the row only
      // every few polls, not twice a second for every viewer.
      if (taken.fresh.length === 0 && emptyPolls % ROW_EVERY === 0) {
        // A Run that is over but never wrote `end` (its workflow died) stops here.
        const latest = await runs.get(runId);
        if (!latest || isOver(latest.status)) {
          if (overPolls < OVER_GRACE_POLLS) {
            overPolls += 1;
          } else {
            if (latest)
              yield {
                seq: cursor.after,
                at: ports.now(),
                type: "end",
                status: latest.status as "completed" | "failed" | "stopped",
                ...(latest.error ? { error: latest.error } : {}),
                ...(latest.stopped_by ? { stoppedBy: latest.stopped_by } : {}),
              };
            return;
          }
        }
      }
      await wait(POLL_MS, signal);
    }
  }

  return {
    async list(owner) {
      const rows = await runs.list(owner, 40);
      return (await Promise.all(rows.map(closeIfStale))).map(toSummary);
    },

    async detail(owner, runId) {
      if (!isId(runId)) throw noSuchRun();
      // The Trail is read beside the row, and shown only if the row is the Owner's.
      const [found, events] = await Promise.all([
        runs.owned(owner, runId),
        ports.trail.after(runId, 0, WHOLE_TRAIL),
      ]);
      if (!found) throw noSuchRun();
      const run = await closeIfStale(found);
      return {
        ...toSummary(run),
        // Closing a stale Run wrote its `end`: read the Trail again for it.
        events:
          run === found
            ? events
            : await ports.trail.after(runId, 0, WHOLE_TRAIL),
        findings: Array.isArray(run.findings) ? run.findings : [],
        expected: (expectedOf(run.task_id) ?? []).map((item) => item.label),
        rulebook: runRulebook(run),
      };
    },

    async trail(owner, runId, after) {
      await owned(owner, runId);
      const events = await ports.trail.after(
        runId,
        Math.max(0, Math.trunc(after)),
        LIMITS.trailEvents,
      );
      return { events, more: events.length === LIMITS.trailEvents };
    },

    async frame(owner, runId, n) {
      if (!isId(runId) || !(await runs.owns(owner, runId))) throw noSuchRun();
      const png =
        Number.isInteger(n) && n >= 0 && n <= MAX_FRAME
          ? await ports.frames.get(runId, n)
          : null;
      if (!png) throw new NotFoundError("No such Frame.");
      return png;
    },

    async follow(owner, runId, after, signal) {
      if (!isId(runId) || !(await runs.owns(owner, runId))) throw noSuchRun();
      return stream(runId, after, signal);
    },

    async start(caller, input) {
      if (!ports.screen.available())
        throw new ConflictError(
          "The Screen sandbox is not set up here, so no Run can start.",
        );
      const resolved = await resolveTask(
        caller.owner,
        input.task,
        input.manifestId ?? null,
      );
      const stubbed = ports.stub;
      const model =
        input.driver === "operator" && !stubbed
          ? (input.model ?? DEFAULT_MODEL)
          : null;
      const current = await ports.rulebooks.current(caller.owner);
      const secret = randomBytes(24).toString("hex");
      const created = await runs.create({
        owner: caller.owner,
        visitorHash: caller.visitor.hash,
        driver: input.driver,
        taskId: resolved.taskId,
        title: resolved.title,
        brief: resolved.brief,
        manifestId: resolved.manifestId,
        manifestName: resolved.manifest?.name ?? null,
        model,
        rulebookVersion: current.version,
        rulebook: current.rulebook,
        stubbed,
        screenSecret: secret,
        limits: limitsFor(caller.visitor),
      });
      if ("refusal" in created) throw new LimitError(created.refusal);
      const { runId } = created;
      const ctx: RunContext = {
        runId,
        driver: input.driver,
        taskId: resolved.taskId,
        title: resolved.title,
        brief: resolved.brief,
        model,
        stubbed,
        rulebook: current.rulebook,
        rulebookVersion: current.version,
        secret,
        manifest: resolved.manifest,
      };
      try {
        await emit(runId, {
          type: "start",
          driver: input.driver,
          task: {
            id: resolved.taskId,
            title: resolved.title,
            brief: resolved.brief,
          },
          manifest: resolved.manifest
            ? {
                name: resolved.manifest.name,
                rows: resolved.manifest.lines.length,
              }
            : null,
          model,
          rulebookVersion: current.version,
        });
        if (input.driver === "operator") {
          await runs.setWorkflowRun(runId, await ports.workflow.start(ctx));
        } else {
          // A client's Screen boots inside its MCP request. Give up before the
          // route's own limit, so the Run is closed and its slot freed rather
          // than left `running` by a killed function.
          const begun = await withDeadline(steps.begin(ctx), CLIENT_BOOT_MS);
          await steps.saveCounters(ctx, begun.counters);
        }
      } catch (error) {
        return failStart(runId, error);
      }
      return { runId };
    },

    async stop(owner, runId) {
      const run = await owned(owner, runId);
      if (isOver(run.status))
        return { runId: run.id, stopped: false, status: run.status };
      if (!(await runs.endIfGoing(run.id, { status: "stopped" }))) {
        const latest = await runs.get(run.id);
        return {
          runId: run.id,
          stopped: false,
          status: latest?.status ?? run.status,
        };
      }
      const events: RunEventInput[] = [
        { type: "log", level: "warn", text: "Stopped by its Owner." },
        { type: "end", status: "stopped" },
      ];
      // Each step past the row is best effort (conventions.md: "Make the
      // escape hatch work when the thing it escapes is broken").
      await ports.trail.append(run.id, events).catch(() => {});
      await approvals.expirePending(run.id).catch(() => {});
      if (run.workflow_run_id)
        await ports.workflow
          .cancel(run.workflow_run_id, "Stopped by its Owner")
          .catch(() => {});
      await steps.dispose(run.id);
      return { runId: run.id, stopped: true, status: "stopped" };
    },

    async decide(input) {
      const run = await owned(input.owner, input.runId);
      if (input.by === "client" && run.driver === "client")
        throw new ForbiddenError(
          "Refused: this Run is driven through the MCP server, so its Approvals are decided by a person in the app.",
        );
      if (run.status !== "paused")
        throw new ConflictError("This Run is not waiting for a decision.");
      if (await expireIfLate(input.owner, run))
        throw new ConflictError(
          "Too late: nobody decided in time, so the harness refused the change and the Run carried on.",
        );
      const claimed = await approvals.decide(
        run.id,
        input.approvalId,
        input.decision,
      );
      if (!claimed)
        throw new ConflictError("That Approval was already decided.");
      if (run.driver === "operator") {
        try {
          await ports.workflow.resume(claimed.hook_token as string, {
            decision: input.decision,
          });
        } catch (error) {
          console.error("[operator] resume failed", error);
          const reason = "The Run could not be resumed after the decision.";
          // The workflow would otherwise sleep out its wait; it acts on nothing
          // once the row is over, but it should not linger. Best effort.
          if (run.workflow_run_id)
            await ports.workflow
              .cancel(run.workflow_run_id, reason)
              .catch(() => {});
          if (
            await runs.endIfGoing(run.id, { status: "failed", error: reason })
          )
            await ports.trail
              .append(run.id, [
                {
                  type: "decision",
                  approvalId: claimed.id,
                  decision: input.decision,
                },
                { type: "end", status: "failed", error: reason },
              ])
              .catch(() => {});
          await steps.dispose(run.id);
          throw new ConflictError(reason);
        }
        return { ok: true };
      }
      try {
        const ctx = await loadContext(input.owner, run);
        await steps.settle(
          ctx,
          claimed.id,
          claimed.fingerprint,
          input.decision,
        );
      } catch (error) {
        console.error("[operator] settle failed", error);
        throw new ConflictError(
          "The decision was saved, but the Screen could not be reached.",
        );
      }
      return { ok: true };
    },

    async clientCall(owner, runId, toolName, input) {
      let run = await closeIfStale(await owned(owner, runId));
      if (run.driver !== "client")
        throw new ConflictError(
          'This Run is not driven through the MCP server. Start one with driver "client".',
        );
      let note = "";
      if (run.status === "paused" && (await expireIfLate(owner, run))) {
        note =
          "The pending Approval expired: nobody decided in time, so the harness refused that change and its key was not pressed. ";
        run = (await runs.get(run.id)) ?? run;
      }
      if (run.status === "paused")
        throw new ConflictError(
          "The Run is paused: a person must approve or refuse the pending Action in the app first.",
        );
      if (run.status !== "running")
        throw new ConflictError(`The Run is ${run.status}.`);
      // One call at a time: two at once would read the same counters, take the
      // same Frame number and could pass the Run's caps together.
      if (!(await runs.claimClientCall(run.id)))
        throw new ConflictError(
          "Another call on this Run is still going. Send this one again when it has answered.",
        );
      try {
        return await claimedCall(owner, run.id, toolName, input, note);
      } finally {
        await runs.releaseClientCall(run.id).catch(() => {});
      }
    },

    async fileHand(caller, attempt) {
      const task = sampleTask(attempt.taskId);
      if (!task) throw new InvalidError("No such sample Task.");
      if (attempt.inputs.length === 0)
        throw new InvalidError("Nothing was keyed.");
      if (attempt.inputs.length > LIMITS.handInputs)
        throw new InvalidError(
          `An attempt is at most ${LIMITS.handInputs} inputs.`,
        );
      // Refuse before the replay, so a visitor over the cap costs a count, not
      // a replay. `runs.create` checks again under its lock; that one is the gate.
      if (
        !caller.visitor.trusted &&
        (await runs.countHandSince(
          caller.visitor.hash,
          new Date(ports.now() - 3_600_000),
        )) >= LIMITS.handRunsPerVisitorPerHour
      )
        throw new LimitError(
          `That's ${LIMITS.handRunsPerVisitorPerHour} in the last hour. Try again later.`,
        );
      let state = boot(task.fixture, HAND_EPOCH);
      const screens = new Set<ScreenCode>([state.screen]);
      let clock = 0;
      for (const item of attempt.inputs) {
        clock = Math.max(clock, item.at);
        for (const atom of inputsOf(item.action)) {
          state = step(state, atom, HAND_EPOCH + clock);
          screens.add(state.screen);
        }
      }
      const changes = diffBooks(task.fixture.books, state.books);
      const current = await ports.rulebooks.current(caller.owner);
      const manifest = task.manifest ? parseManifest(task.manifest.text) : null;
      const checked = evaluate({
        rulebook: current.rulebook,
        expected: task.expected,
        manifest: manifest
          ? { voyage: manifest.voyage, lines: manifest.lines }
          : null,
        changes,
        after: state.books,
        signedOn: state.signedOn,
        screens: [...screens],
        approved: [],
        byHand: true,
      });
      const ms = Math.min(
        Math.max(Math.trunc(attempt.elapsedMs) || clock, clock),
        3_600_000,
      );
      const created = await runs.create({
        owner: caller.owner,
        visitorHash: caller.visitor.hash,
        driver: "hand",
        taskId: task.id,
        title: task.title,
        brief: task.brief,
        manifestId: null,
        manifestName: task.manifest?.name ?? null,
        model: null,
        rulebookVersion: current.version,
        rulebook: current.rulebook,
        stubbed: false,
        screenSecret: null,
        finished: {
          verdict: checked.verdict,
          findings: checked.findings,
          metrics: {
            ...EMPTY_METRICS,
            actions: attempt.inputs.length,
            records: changes.length,
            errors: state.errors,
            ms,
          },
        },
        limits: limitsFor(caller.visitor, true),
      });
      if ("refusal" in created) throw new LimitError(created.refusal);
      await emit(
        created.runId,
        {
          type: "start",
          driver: "hand",
          task: { id: task.id, title: task.title, brief: task.brief },
          manifest: manifest
            ? { name: task.manifest?.name ?? "", rows: manifest.lines.length }
            : null,
          model: null,
          rulebookVersion: current.version,
        },
        {
          type: "log",
          level: "info",
          text: `Keyed by hand: ${attempt.inputs.length} inputs replayed by the server. Ended on ${frameHint(state.screen, "")}.`,
        },
        {
          type: "findings",
          verdict: checked.verdict,
          findings: checked.findings,
        },
        { type: "end", status: "completed", stoppedBy: "finish" },
      );
      return { runId: created.runId };
    },
  };
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
