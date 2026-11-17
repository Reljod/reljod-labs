import type { RunStartRequest } from "../../domain/api";
import type { SourceView } from "../../domain/knowledge";
import type { PipelineId } from "../../domain/pipeline";
import type { RunSummary, RunView } from "../../domain/run";
import type { Staff } from "../../domain/staff";
import type { ControllerName, HarnessControllers } from "../harness-context";

/**
 * Demo mode's Beat engine. Pure: no React, no DOM, no network. It runs a
 * Scenario's Beats one press of Next at a time against a `Host` (the part of
 * the app a Beat may touch), and keeps the state a visitor sees in the guide
 * bar. The live model means a Beat can end somewhere the script did not
 * expect, so a Beat has more outcomes than done: it can drift (what it waited
 * for did not happen) or fail (an action was refused), and both leave a way on.
 */

// What a Beat may touch ------------------------------------------------------------

/**
 * The app as a Beat sees it. Built from `useHarness()`, `controller(name)`
 * and the Harness API in `use-host.ts`; a test passes fakes.
 */
export type Host = {
  /** Who is signed in right now. */
  staff(): Pick<Staff, "id" | "key" | "name" | "title" | "role">;
  controller<Name extends ControllerName>(
    name: Name,
  ): Promise<HarnessControllers[Name]>;
  runs: {
    list(sessionId: string): Promise<RunSummary[]>;
    get(runId: string): Promise<RunView>;
    start(request: RunStartRequest): Promise<RunView>;
    stop(runId: string): Promise<RunView>;
  };
  sources: { list(): Promise<SourceView[]> };
  rules: { restore(ruleId: string): Promise<void> };
  sandbox: { status(sessionId: string | null): Promise<SandboxReading> };
  /** Today, `YYYY-MM-DD`, in UTC. */
  today(): string;
};

/** What a Beat needs to know about the Sandbox. */
export type SandboxReading = {
  usable: boolean;
  /** What to tell the visitor when it is not. */
  message: string | null;
};

/** What a Beat carries from one Beat to the next. Small, and saved so a reload can resume. */
export type ScenarioState = {
  /** The Session this Scenario made. */
  sessionId: string | null;
  /** The Run the Beats are about now. */
  runId: string | null;
  /** Every Run this Scenario has seen, oldest first, so "the new Run" means a new one. */
  runIds: string[];
  /** Sample ids attached in the Session, so a Run can be started on them directly. */
  attached: string[];
};

export const EMPTY_STATE: ScenarioState = {
  sessionId: null,
  runId: null,
  runIds: [],
  attached: [],
};

// Scenarios as data ----------------------------------------------------------------

export type Feature =
  | "Pipeline"
  | "Approval"
  | "Rules"
  | "Knowledge base"
  | "Conflict"
  | "Audit"
  | "Sandbox"
  | "Claude";

/** A part of the app a Beat acts on: it gets the ring, and its tab opens. */
export type Focus =
  | "chat"
  | "pipelines"
  | "knowledge"
  | "skills"
  | "audit"
  | "docs";

/** What a Beat waits for after its actions, and for how long. */
export type SettleKind =
  /** A Run of the expected Pipeline has appeared in the Session. */
  | "run-started"
  /** The Run is no longer queued or running: it ended or is waiting for a person. */
  | "run-quiet"
  /** The Run has ended. */
  | "run-ended";

export type Settle = { kind: SettleKind; timeoutMs: number };

/** What to offer when the Agent did not do what the Beat expected. */
export type DriftPlan = {
  /** The Pipeline a Run should have appeared for. */
  pipelineId: PipelineId;
  /** A firmer follow-up line, for "Ask again". */
  askAgain: string;
  /** The input for "Start it for me". */
  start(ctx: BeatContext): Promise<Record<string, unknown>>;
};

export type BeatContext = {
  host: Host;
  /** Aborted when the visitor cancels or skips the wait. */
  signal: AbortSignal;
  /** Where the Scenario is: mutate it, it is saved after each Beat. */
  state: ScenarioState;
  /** The Beat being run. */
  beat: Beat;
  /** Adds a line to the log of what was done. */
  log(text: string): void;
  /** Says what the Beat is waiting for, on the disabled Next button. */
  pending(label: string): void;
  /** Shows the visitor something to look at or read (a refusal, what to click). */
  notice(text: string): void;
};

export type Action = (ctx: BeatContext) => Promise<void>;

export type Beat = {
  id: string;
  /** What is about to happen and why it matters: one or two sentences. */
  say: string;
  /** The part of the app it acts on. */
  focus?: Focus;
  /** What Next says while it works. */
  pendingLabel?: string;
  run: Action;
  settle?: Settle;
  onDrift?: DriftPlan;
  /** Links the guide bar offers for this Beat. */
  links?: { href: string; label: string }[];
};

export type Scenario = {
  id: string;
  title: string;
  /** What it shows, in a sentence. */
  summary: string;
  features: Feature[];
  /** Roughly how long it takes with the live model. */
  minutes: number;
  /** Who the visitor is for most of it. */
  asRole: string;
  beats: Beat[];
};

// State machine ---------------------------------------------------------------------

export type BeatStatus = "idle" | "running" | "settled" | "drifted" | "failed";

export type RecoverKind = "ask-again" | "start";

export type LogEntry = {
  id: number;
  beat: number;
  kind: "done" | "problem";
  text: string;
};

export type EngineState = {
  scenarioId: string;
  /** The Beat the next press runs, or the one now running, retried or stuck. */
  index: number;
  status: BeatStatus;
  /** What the disabled Next says. */
  pending: string | null;
  /** When the running Beat began (ms), for "Skip waiting" after a few seconds. */
  runningSince: number | null;
  /** Plain words on what went wrong or drifted. */
  problem: string | null;
  /** Something for the visitor to look at or read. */
  notice: string | null;
  /** What "drifted" or "failed" can still be recovered with. */
  recover: RecoverKind[];
  /** Every Beat has been done or skipped. */
  finished: boolean;
  log: LogEntry[];
  state: ScenarioState;
};

export type EngineOptions = {
  scenario: Scenario;
  host: Host;
  /** Resume at this Beat. */
  startIndex?: number;
  state?: ScenarioState;
  now?: () => number;
  /** How often a settle check polls. */
  pollMs?: number;
  /** Called after each change of state that is worth saving. */
  onSave?: (state: EngineState) => void;
};

/** What a Beat waited for did not happen. Becomes `drifted`. */
export class DriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriftError";
  }
}

/** The reasons a Beat's signal is aborted. */
export const ABORT = { cancel: "cancel", skipWait: "skip-wait" } as const;

const FAILED_FALLBACK = "That didn't work. Try again.";

export function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : FAILED_FALLBACK;
}

/** Resolves with the promise, or rejects with the abort reason as soon as the signal aborts. */
export function raceAbort<T>(
  signal: AbortSignal,
  work: Promise<T>,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

class AbortReason extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AbortReason";
  }
}

function abortError(signal: AbortSignal) {
  return new AbortReason(String(signal.reason ?? ABORT.cancel));
}

/** Waits `ms`, or rejects when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return raceAbort(
    signal,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  );
}

/** One check of a settle condition: done, or why not yet. */
export type SettleCheck = { done: true } | { done: false; why: string };

export type Settlers = Record<
  SettleKind,
  (ctx: BeatContext) => Promise<SettleCheck>
>;

export class DemoEngine {
  private snapshot: EngineState;
  private readonly listeners = new Set<() => void>();
  /** Synchronous guard: a second press of Next in the same tick does nothing. */
  private busy = false;
  private token = 0;
  private controller: AbortController | null = null;
  private nextLogId = 1;
  private readonly now: () => number;
  private readonly pollMs: number;

  constructor(
    private readonly options: EngineOptions,
    private readonly settlers: Settlers,
  ) {
    this.now = options.now ?? Date.now;
    this.pollMs = options.pollMs ?? 1_500;
    const index = Math.min(
      Math.max(options.startIndex ?? 0, 0),
      options.scenario.beats.length,
    );
    this.snapshot = {
      scenarioId: options.scenario.id,
      index,
      status: "idle",
      pending: null,
      runningSince: null,
      problem: null,
      notice: null,
      recover: [],
      finished: index >= options.scenario.beats.length,
      log: [],
      state: { ...EMPTY_STATE, ...(options.state ?? {}) },
    };
  }

  // Store --------------------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): EngineState => this.snapshot;

  get scenario(): Scenario {
    return this.options.scenario;
  }

  get beat(): Beat | null {
    return this.options.scenario.beats[this.snapshot.index] ?? null;
  }

  private set(patch: Partial<EngineState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private addLog(kind: LogEntry["kind"], text: string, beat: number) {
    const entry: LogEntry = { id: this.nextLogId++, beat, kind, text };
    this.set({ log: [...this.snapshot.log, entry] });
  }

  // Presses ------------------------------------------------------------------------

  /** Next: does the next Beat. Ignored while one is running or when one needs a decision. */
  async next(): Promise<void> {
    if (this.busy) return;
    const { status, finished } = this.snapshot;
    if (finished || status === "drifted" || status === "failed") return;
    await this.execute("run");
  }

  /** Does the Beat that drifted or failed again. */
  async retry(): Promise<void> {
    if (this.busy) return;
    if (!this.needsDecision()) return;
    await this.execute("run");
  }

  /** Leaves the Beat that drifted or failed undone and goes on to the next. */
  skip(): void {
    if (this.busy) return;
    if (!this.needsDecision()) return;
    this.advance();
  }

  /** "Ask again" or "Start it for me" after a drift or a failure. */
  async recover(kind: RecoverKind): Promise<void> {
    if (this.busy) return;
    if (!this.needsDecision()) return;
    if (!this.snapshot.recover.includes(kind)) return;
    await this.execute(kind);
  }

  /** Stops waiting for the Beat in flight and calls it drifted. */
  skipWaiting(): void {
    if (this.busy && this.snapshot.status === "running") {
      this.controller?.abort(ABORT.skipWait);
    }
  }

  /** Abandons the Beat in flight. Its work may still finish; the engine ignores it. */
  cancel(): void {
    if (!this.busy) return;
    this.token += 1;
    this.controller?.abort(ABORT.cancel);
    this.busy = false;
    this.controller = null;
    this.set({
      status: "idle",
      pending: null,
      runningSince: null,
      problem: null,
      recover: [],
    });
  }

  private needsDecision() {
    const { status } = this.snapshot;
    return status === "drifted" || status === "failed";
  }

  private advance() {
    const index = this.snapshot.index + 1;
    this.set({
      index,
      status: "idle",
      pending: null,
      runningSince: null,
      problem: null,
      recover: [],
      finished: index >= this.options.scenario.beats.length,
    });
    this.options.onSave?.(this.snapshot);
  }

  // One Beat -----------------------------------------------------------------------

  private async execute(mode: "run" | RecoverKind): Promise<void> {
    const beat = this.beat;
    if (!beat || this.busy) return;
    this.busy = true;
    const token = ++this.token;
    const controller = new AbortController();
    this.controller = controller;
    const index = this.snapshot.index;
    const stale = () => token !== this.token;

    const state: ScenarioState = {
      ...this.snapshot.state,
      runIds: [...this.snapshot.state.runIds],
      attached: [...this.snapshot.state.attached],
    };
    const ctx: BeatContext = {
      host: this.options.host,
      signal: controller.signal,
      state,
      beat,
      log: (text) => {
        if (!stale()) this.addLog("done", text, index);
      },
      pending: (label) => {
        if (!stale()) this.set({ pending: label });
      },
      notice: (text) => {
        if (!stale()) this.set({ notice: text });
      },
    };

    this.set({
      status: "running",
      pending: beat.pendingLabel ?? "Working…",
      runningSince: this.now(),
      problem: null,
      notice: null,
      recover: [],
    });

    try {
      await raceAbort(
        controller.signal,
        this.work(mode, beat, ctx, controller.signal),
      );
      if (stale()) return;
      this.set({ state });
      this.busy = false;
      this.controller = null;
      this.advance();
    } catch (caught) {
      if (stale()) return;
      this.busy = false;
      this.controller = null;
      const recover = recoveries(beat);
      if (caught instanceof AbortReason) {
        const message =
          caught.reason === ABORT.skipWait
            ? "You stopped waiting before it finished."
            : "That Beat was cancelled.";
        this.stop("drifted", message, recover, state, index);
        return;
      }
      if (caught instanceof DriftError) {
        this.stop("drifted", caught.message, recover, state, index);
        return;
      }
      this.stop("failed", messageOf(caught), recover, state, index);
    }
  }

  private stop(
    status: "drifted" | "failed",
    problem: string,
    recover: RecoverKind[],
    state: ScenarioState,
    index: number,
  ) {
    this.addLog("problem", problem, index);
    this.set({
      status,
      pending: null,
      runningSince: null,
      problem,
      recover,
      state,
    });
    this.options.onSave?.(this.snapshot);
  }

  private async work(
    mode: "run" | RecoverKind,
    beat: Beat,
    ctx: BeatContext,
    signal: AbortSignal,
  ): Promise<void> {
    if (mode === "run") {
      await beat.run(ctx);
    } else if (beat.onDrift) {
      await this.recoverWith(mode, beat.onDrift, ctx);
      // "Start it for me" makes the thing the Beat settles on: no need to wait for it.
      if (mode === "start") return;
    }
    if (beat.settle) await this.settle(beat.settle, ctx, signal);
  }

  private async recoverWith(
    kind: RecoverKind,
    plan: DriftPlan,
    ctx: BeatContext,
  ) {
    if (kind === "ask-again") {
      const chat = await ctx.host.controller("chat");
      ctx.pending("Waiting for the Agent…");
      await chat.send(plan.askAgain);
      ctx.log(`Asked the Agent again: “${plan.askAgain}”`);
      await chat.waitIdle();
      return;
    }
    const input = await plan.start(ctx);
    ctx.pending("Starting the Run…");
    const run = await ctx.host.runs.start({
      pipelineId: plan.pipelineId,
      input,
      sessionId: ctx.state.sessionId,
      via: "demo",
    });
    ctx.state.runId = run.id;
    if (!ctx.state.runIds.includes(run.id)) ctx.state.runIds.push(run.id);
    ctx.log(
      "The guide started this Run itself, because the Agent had not. It is a real Run, marked as started from Demo mode.",
    );
  }

  /** Polls a Beat's condition until it holds, or until the time is up (a drift). */
  private async settle(settle: Settle, ctx: BeatContext, signal: AbortSignal) {
    const deadline = this.now() + settle.timeoutMs;
    const check = this.settlers[settle.kind];
    let why = "It did not happen in time.";
    for (;;) {
      const result = await check(ctx);
      if (result.done) return;
      why = result.why;
      if (this.now() >= deadline) throw new DriftError(why);
      await sleep(
        Math.min(this.pollMs, Math.max(deadline - this.now(), 0)),
        signal,
      );
    }
  }
}

function recoveries(beat: Beat): RecoverKind[] {
  if (!beat.onDrift) return [];
  return ["ask-again", "start"];
}
