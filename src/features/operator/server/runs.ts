import "server-only";
import { randomBytes } from "node:crypto";
import { getRun as getWorkflowRun, resumeHook, start } from "workflow/api";
import type { Owner } from "@/features/access/domain/owner";
import { evaluate } from "../domain/checks";
import {
  DEFAULT_MODEL,
  EMPTY_METRICS,
  type HandInput,
  isOver,
  type ModelId,
  type RunEventInput,
  type TaskRef,
} from "../domain/contract";
import { LIMITS, STALE_RUN_MS } from "../domain/limits";
import { parseManifest } from "../domain/manifest";
import { OWN_SIGN_ON } from "../domain/task-cards";
import { sampleTask } from "../domain/tasks";
import { diffBooks } from "../legacy/books";
import { inputsOf } from "../legacy/input";
import { boot, step } from "../legacy/machine";
import type { ScreenCode } from "../legacy/types";
import { frameHint, openApproval } from "./act";
import { disposeCode } from "./code-sandbox";
import {
  type Counters,
  contextOf,
  countersOf,
  type RunContext,
} from "./context";
import { emit } from "./emit";
import { env } from "./env";
import { finishRun } from "./finish";
import type { ToolCall } from "./operator";
import {
  claimClientCall,
  countHandRunsSince,
  createRun,
  currentRulebook,
  decideApprovalRow,
  endRunIfGoing,
  expirePending,
  getRunRow,
  insertEvents,
  ownedManifest,
  ownedRun,
  pausedMsOf,
  type RunRow,
  releaseClientCall,
  setWorkflowRun,
} from "./repository";
import { begin, runCall, saveCounters, settle } from "./run-steps";
import { operatorRun } from "./run-workflow";
import { disposeScreen, ScreenUnavailable, screenBooks } from "./screen";
import type { Visitor } from "./visitor";

/*
 * Starting, stopping and deciding Runs, for the page's server actions and
 * the MCP tools alike: both call these, so the caps, the Rules and the Trail
 * are the same whichever way a request comes in (ADR 0025).
 */

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

/** Closes a Run whose workflow or driver is long gone, so it stops counting as active. */
export async function closeIfStale(run: RunRow): Promise<RunRow> {
  if (isOver(run.status)) return run;
  if (Date.now() - run.started_at.getTime() < STALE_RUN_MS) return run;
  const error = "The Run ran out of time and was closed.";
  if (!(await endRunIfGoing(run.id, { status: "failed", error })))
    return (await getRunRow(run.id)) ?? run;
  await insertEvents(run.id, [{ type: "end", status: "failed", error }]).catch(
    () => {},
  );
  await expirePending(run.id).catch(() => {});
  await Promise.all([disposeScreen(run.id), disposeCode(run.id)]);
  return {
    ...run,
    status: "failed",
    error,
    ended_at: new Date(),
    pending: null,
  };
}

type Resolved = {
  taskId: string | null;
  title: string;
  brief: string;
  manifestId: string | null;
  manifest: RunContext["manifest"];
};

/** What a Run is asked to do, checked against the Owner: the Task and its Manifest. */
async function resolveTask(
  owner: Owner,
  task: TaskRef,
  manifestId: string | null,
): Promise<Resolved | { error: string }> {
  let manifest: RunContext["manifest"] = null;
  let attached: string | null = null;
  if (manifestId) {
    const row = await ownedManifest(owner, manifestId);
    if (!row || row.status !== "read" || !row.parsed || row.body === null)
      return { error: "No such Manifest. Attach it again." };
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
    if (!sample) return { error: "No such sample Task." };
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
    return { error: "Say what the Operator should do, in a sentence or two." };
  if (words.length > LIMITS.taskChars)
    return { error: `A Task is at most ${LIMITS.taskChars} characters.` };
  return {
    taskId: null,
    title: words.length > 70 ? `${words.slice(0, 67)}...` : words,
    brief: `${OWN_SIGN_ON}\n${words}`,
    manifestId: attached,
    manifest,
  };
}

async function failStart(runId: string, error: unknown) {
  const shown =
    error instanceof ScreenUnavailable
      ? error.message
      : "The Run could not be started.";
  if (!(error instanceof ScreenUnavailable))
    console.error("[operator] start failed", error);
  if (await endRunIfGoing(runId, { status: "failed", error: shown }))
    await insertEvents(runId, [
      { type: "end", status: "failed", error: shown },
    ]).catch(() => {});
  await Promise.all([disposeScreen(runId), disposeCode(runId)]);
  return { error: `${shown} Try again.` };
}

/**
 * Starts a Run under the limits (per visitor per hour, per Owner per day,
 * one live Screen per Owner), under the Owner's current Rulebook, which is
 * snapshotted on the Run. `operator`: a workflow drives it. `client`: the
 * Screen is started here and the caller drives it with the screen tools.
 */
export async function startRun(input: {
  owner: Owner;
  visitor: Visitor;
  task: TaskRef;
  manifestId?: string | null;
  model?: ModelId;
  driver: "operator" | "client";
  /** The scripted Operator; honoured only for the e2e visitor and a sample Task. */
  stubbed?: boolean;
}): Promise<{ runId: string } | { error: string }> {
  if (!env.sandboxConfigured())
    return {
      error: "The Screen sandbox is not set up here, so no Run can start.",
    };
  const resolved = await resolveTask(
    input.owner,
    input.task,
    input.manifestId ?? null,
  );
  if ("error" in resolved) return resolved;
  const stubbed = Boolean(
    input.stubbed && input.visitor.trusted && resolved.taskId,
  );
  const model =
    input.driver === "operator" && !stubbed
      ? (input.model ?? DEFAULT_MODEL)
      : null;
  const current = await currentRulebook(input.owner);
  const secret = randomBytes(24).toString("hex");
  const created = await createRun({
    owner: input.owner,
    visitorHash: input.visitor.hash,
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
    limits: limitsFor(input.visitor),
  });
  if ("refusal" in created) return { error: created.refusal };
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
        ? { name: resolved.manifest.name, rows: resolved.manifest.lines.length }
        : null,
      model,
      rulebookVersion: current.version,
    });
    if (input.driver === "operator") {
      const run = await start(operatorRun, [{ ctx }]);
      await setWorkflowRun(runId, run.runId);
    } else {
      // A client's Screen boots inside its MCP request. Give up before the
      // route's own limit, so the Run is closed and its slot freed rather than
      // left `running` by a killed function.
      const begun = await withDeadline(begin(ctx), CLIENT_BOOT_MS);
      await saveCounters(ctx, begun.counters);
    }
  } catch (error) {
    return failStart(runId, error);
  }
  return { runId };
}

/**
 * Stops a Run. The local state change comes first and always happens; the
 * workflow cancel and the sandbox removal are best effort (conventions.md:
 * "Make the escape hatch work when the thing it escapes is broken").
 */
export async function stopRun(owner: Owner, runId: string) {
  const run = await ownedRun(owner, runId);
  if (!run) return { error: "No such Run." };
  if (isOver(run.status))
    return { runId: run.id, stopped: false, status: run.status };
  if (!(await endRunIfGoing(run.id, { status: "stopped" }))) {
    const latest = await getRunRow(run.id);
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
  await insertEvents(run.id, events).catch(() => {});
  await expirePending(run.id).catch(() => {});
  if (run.workflow_run_id) {
    try {
      await getWorkflowRun(run.workflow_run_id).cancel({
        cancelReason: "Stopped by its Owner",
      });
    } catch {
      // Already ended, or the workflow is gone: the row is closed either way.
    }
  }
  await Promise.all([disposeScreen(run.id), disposeCode(run.id)]);
  return { runId: run.id, stopped: true, status: "stopped" as const };
}

/** The context of a Run on its row, with its Manifest loaded again. */
async function loadContext(owner: Owner, row: RunRow): Promise<RunContext> {
  const resolved = await resolveTask(
    owner,
    row.task_id
      ? { kind: "sample", taskId: row.task_id }
      : { kind: "own", brief: row.brief },
    row.manifest_id,
  );
  return contextOf(row, "error" in resolved ? null : resolved.manifest);
}

/**
 * A decision on a paused Action. `by: "client"` is an MCP caller: it may
 * decide for a Run the Operator drives, never for one it drives itself. The
 * in-app Operator has no way to call this at all.
 */
export async function decideApproval(input: {
  owner: Owner;
  runId: string;
  approvalId: string;
  decision: "approved" | "refused";
  by: "person" | "client";
}): Promise<{ ok: true } | { error: string }> {
  const run = await ownedRun(input.owner, input.runId);
  if (!run) return { error: "No such Run." };
  if (input.by === "client" && run.driver === "client")
    return {
      error:
        "Refused: this Run is driven through the MCP server, so its Approvals are decided by a person in the app.",
    };
  if (run.status !== "paused")
    return { error: "This Run is not waiting for a decision." };
  if (await expireIfLate(input.owner, run))
    return {
      error:
        "Too late: nobody decided in time, so the harness refused the change and the Run carried on.",
    };
  const claimed = await decideApprovalRow(
    run.id,
    input.approvalId,
    input.decision,
  );
  if (!claimed) return { error: "That Approval was already decided." };
  if (run.driver === "operator") {
    try {
      await resumeHook(claimed.hook_token as string, {
        decision: input.decision,
      });
    } catch (error) {
      console.error("[operator] resume failed", error);
      const reason = "The Run could not be resumed after the decision.";
      // The workflow would otherwise sleep out its wait; it acts on nothing
      // once the row is over, but it should not linger. Best effort.
      if (run.workflow_run_id)
        await getWorkflowRun(run.workflow_run_id)
          .cancel({ cancelReason: reason })
          .catch(() => {});
      if (await endRunIfGoing(run.id, { status: "failed", error: reason }))
        await insertEvents(run.id, [
          {
            type: "decision",
            approvalId: claimed.id,
            decision: input.decision,
          },
          { type: "end", status: "failed", error: reason },
        ]).catch(() => {});
      await Promise.all([disposeScreen(run.id), disposeCode(run.id)]);
      return { error: reason };
    }
    return { ok: true };
  }
  try {
    const ctx = await loadContext(input.owner, run);
    await settle(ctx, claimed.id, claimed.fingerprint, input.decision);
  } catch (error) {
    console.error("[operator] settle failed", error);
    return {
      error: "The decision was saved, but the Screen could not be reached.",
    };
  }
  return { ok: true };
}

/**
 * A client-driven Run has no workflow to expire its Approval, so the harness
 * does it on the next call or decision that touches the Run: the change is
 * refused, the Run goes back to running, and the Trail says so. True when it
 * expired the Approval here. An Operator-driven Run's workflow expires its own.
 */
async function expireIfLate(owner: Owner, run: RunRow): Promise<boolean> {
  const pending = run.pending;
  if (run.driver !== "client" || run.status !== "paused" || !pending)
    return false;
  if (pending.expiresAt > Date.now()) return false;
  const expired = await decideApprovalRow(
    run.id,
    pending.approvalId,
    "expired",
  );
  // Decided by a person a moment ago: their decision stands.
  if (!expired) return false;
  try {
    await settle(
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

// A Run an outside client drives -------------------------------------------------------------

export type ClientCallResult =
  | { error: string }
  | {
      text: string;
      /** The Frame to show the client, when the call took one. */
      frame: number | null;
      finished: boolean;
    };

/**
 * One tool call of a client-driven Run: the same `runCall` the workflow's
 * step uses, so the Guard, the caps and the Trail are the same. A guarded
 * Action opens an Approval a person decides in the app; the client then
 * sends the Action again.
 */
export async function clientCall(
  owner: Owner,
  runId: string,
  toolName: string,
  input: unknown,
): Promise<ClientCallResult> {
  const found = await ownedRun(owner, runId);
  if (!found) return { error: "No such Run." };
  let run = await closeIfStale(found);
  if (run.driver !== "client")
    return {
      error:
        'This Run is not driven through the MCP server. Start one with driver "client".',
    };
  let note = "";
  if (run.status === "paused" && (await expireIfLate(owner, run))) {
    note =
      "The pending Approval expired: nobody decided in time, so the harness refused that change and its key was not pressed. ";
    run = (await getRunRow(run.id)) ?? run;
  }
  if (run.status === "paused")
    return {
      error:
        "The Run is paused: a person must approve or refuse the pending Action in the app first.",
    };
  if (run.status !== "running") return { error: `The Run is ${run.status}.` };
  // One call at a time: two at once would read the same counters, take the
  // same Frame number and could pass the Run's caps together.
  if (!(await claimClientCall(run.id)))
    return {
      error:
        "Another call on this Run is still going. Send this one again when it has answered.",
    };
  try {
    return await claimedCall(owner, run.id, toolName, input, note);
  } finally {
    await releaseClientCall(run.id).catch(() => {});
  }
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
  const run = await getRunRow(runId);
  if (!run || run.status !== "running")
    return { error: `The Run is ${run?.status ?? "gone"}.` };
  const ctx = await loadContext(owner, run);
  let counters: Counters = countersOf(run);
  const startedAt = run.started_at.getTime();
  try {
    // Time spent waiting for a person is the harness's, not the client's.
    const pausedMs = await pausedMsOf(run.id);
    if (
      Date.now() - startedAt - pausedMs >
      (LIMITS.sandboxMinutes - 1) * 60_000
    ) {
      await finishRun(
        ctx,
        counters,
        { status: "completed", stoppedBy: "time" },
        startedAt,
      );
      return {
        error:
          "The Run reached its time limit and was closed; the Books were checked.",
      };
    }
    const call: ToolCall = {
      toolCallId: `client-${counters.turns + 1}`,
      toolName,
      input,
    };
    const keyed =
      toolName === "run_code"
        ? (await screenBooks(ctx.runId, ctx.secret)).diff
        : [];
    counters = { ...counters, turns: counters.turns + 1 };
    const done = await runCall(
      ctx,
      counters,
      { turn: counters.turns, intent: "" },
      call,
      keyed,
    );
    counters = done.counters;
    let text = done.output;
    if (done.outcome?.blocked?.decision.kind === "pause") {
      const opened = await openApproval(ctx, counters, done.outcome, null);
      if (opened) {
        counters = opened.counters;
        text = `${done.output} The Run is paused. A person must approve or refuse it in the app (Approval ${opened.pending.approvalId}); you cannot. Once approved, send the same Action again${done.outcome.blocked.applied > 0 ? `, without the ${done.outcome.blocked.applied} input(s) already applied` : ""}.`;
      }
    }
    if (done.finished !== undefined) {
      await finishRun(
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
    await saveCounters(ctx, counters);
    if (done.hint) text = `${text} (${done.hint})`;
    return { text: `${note}${text}`, frame: done.frame, finished: false };
  } catch (error) {
    if (error instanceof ScreenUnavailable) {
      await finishRun(
        ctx,
        counters,
        { status: "failed", error: error.message },
        startedAt,
      );
      return { error: `${error.message} The Run was closed.` };
    }
    throw error;
  }
}

// Take the keyboard ---------------------------------------------------------------------------

/** A fixed start for a replay, so the session timeout depends only on the gaps between inputs. */
const HAND_EPOCH = Date.UTC(2026, 10, 19, 8, 0, 0);

/**
 * Files a "take the keyboard" attempt. The browser ran HARBOURMASTER itself;
 * the server trusts none of that: it replays the inputs through the same
 * machine from the Task's Fixture and checks the Books it arrives at with
 * the same code as any Run. A person at the keyboard passes no Guard, so the
 * Rules show up as Findings.
 */
export async function submitHandRun(input: {
  owner: Owner;
  visitor: Visitor;
  taskId: string;
  inputs: HandInput[];
  elapsedMs: number;
}): Promise<{ runId: string } | { error: string }> {
  const task = sampleTask(input.taskId);
  if (!task) return { error: "No such sample Task." };
  if (input.inputs.length === 0) return { error: "Nothing was keyed." };
  if (input.inputs.length > LIMITS.handInputs)
    return { error: `An attempt is at most ${LIMITS.handInputs} inputs.` };
  // Refuse before the replay, so a visitor over the cap costs a count, not a
  // replay. `createRun` checks again under its lock; that one is the gate.
  if (
    !input.visitor.trusted &&
    (await countHandRunsSince(
      input.visitor.hash,
      new Date(Date.now() - 3_600_000),
    )) >= LIMITS.handRunsPerVisitorPerHour
  )
    return {
      error: `That's ${LIMITS.handRunsPerVisitorPerHour} in the last hour. Try again later.`,
    };
  let state = boot(task.fixture, HAND_EPOCH);
  const screens = new Set<ScreenCode>([state.screen]);
  let clock = 0;
  for (const item of input.inputs) {
    clock = Math.max(clock, item.at);
    for (const atom of inputsOf(item.action)) {
      state = step(state, atom, HAND_EPOCH + clock);
      screens.add(state.screen);
    }
  }
  const changes = diffBooks(task.fixture.books, state.books);
  const current = await currentRulebook(input.owner);
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
    Math.max(Math.trunc(input.elapsedMs) || clock, clock),
    3_600_000,
  );
  const created = await createRun({
    owner: input.owner,
    visitorHash: input.visitor.hash,
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
        actions: input.inputs.length,
        records: changes.length,
        errors: state.errors,
        ms,
      },
    },
    limits: limitsFor(input.visitor, true),
  });
  if ("refusal" in created) return { error: created.refusal };
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
      text: `Keyed by hand: ${input.inputs.length} inputs replayed by the server. Ended on ${frameHint(state.screen, "")}.`,
    },
    { type: "findings", verdict: checked.verdict, findings: checked.findings },
    { type: "end", status: "completed", stoppedBy: "finish" },
  );
  return { runId: created.runId };
}
