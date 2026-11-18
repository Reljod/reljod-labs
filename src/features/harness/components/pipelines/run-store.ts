import {
  isRunActive,
  type RunEvent,
  type RunView,
  reduceRun,
} from "../../domain/run";

/** Where a Run comes from; `api.runs` is the real one. */
export type RunSource = {
  get(id: string): Promise<RunView>;
  events(
    id: string,
    from: number,
    signal: AbortSignal,
  ): AsyncIterable<RunEvent>;
};

export type WatchState =
  | "loading"
  | "live"
  | "reconnecting"
  | "ended"
  | "error";

export type RunWatch = {
  runId: string;
  run: RunView | null;
  state: WatchState;
  /** Why it stopped trying, when `state` is `error`. */
  error: string | null;
  /** The Run is not there for this Staff member (404, 403, 401): retrying will not help. */
  gone: boolean;
};

export const MAX_RECONNECTS = 8;
/** How long a replayed stream may stay behind the snapshot before it is drawn anyway. */
const REPLAY_GRACE_MS = 1500;

/** A refusal retrying will not change: not signed in, not allowed, not there. */
function isGone(caught: unknown): boolean {
  const status = (caught as { status?: unknown } | null)?.status;
  return status === 401 || status === 403 || status === 404;
}

/** 1 s, 2 s, 4 s … up to 15 s. */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 15_000);
}

/**
 * How far a Run has got, as one number that only grows as events apply.
 * Used to keep a stream that replays from the start from drawing the Run
 * going backwards while it catches up with what `get` already showed.
 */
export function runProgress(run: RunView): number {
  const steps = run.steps.reduce(
    (sum, step) =>
      sum +
      (step.status === "done" ||
      step.status === "failed" ||
      step.status === "skipped"
        ? 2
        : step.status === "running"
          ? 1
          : 0),
    0,
  );
  const approvals = run.approvals.reduce(
    (sum, approval) => sum + (approval.status === "pending" ? 1 : 2),
    0,
  );
  return (
    steps * 10 +
    run.findings.length +
    run.drafts.length +
    approvals +
    (isRunActive(run.status) ? 0 : 1000)
  );
}

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

type Options = {
  /** Waits between reconnects; tests pass an instant one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How many ended Runs to keep; `MAX_ENDED_RUNS` unless a test says otherwise. */
  maxEnded?: number;
};

/**
 * Ended Runs kept for the visit. An ended Run cannot change, so reopening
 * one makes no request; past this many, the least recently opened goes (and
 * is read again if it is opened again).
 */
export const MAX_ENDED_RUNS = 20;

/**
 * Every Run the Pipelines tab has opened, each kept live by its own stream.
 * Switching Runs does not close anything: a Run that is at work keeps
 * streaming in the background, and coming back shows where it got to. A Run
 * that had ended when opened is read once, from `get`, and kept: up to
 * `MAX_ENDED_RUNS` of them, never the one opened last.
 *
 * An external store for `useSyncExternalStore`: every change replaces the
 * snapshot Map.
 */
export class RunStore {
  private entries: ReadonlyMap<string, RunWatch> = new Map();
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly loaded = new Map<string, Set<() => void>>();
  private readonly sleep: NonNullable<Options["sleep"]>;
  private readonly maxEnded: number;
  /** When each Run was last opened, to drop the least recent ended ones first. */
  private readonly opened = new Map<string, number>();
  private openCount = 0;
  private lastOpened: string | null = null;

  constructor(
    private readonly source: RunSource,
    options: Options = {},
  ) {
    this.sleep = options.sleep ?? sleepFor;
    this.maxEnded = Math.max(1, options.maxEnded ?? MAX_ENDED_RUNS);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ReadonlyMap<string, RunWatch> => this.entries;

  get(runId: string): RunWatch | undefined {
    return this.entries.get(runId);
  }

  /**
   * Starts watching a Run, once. Calling it again for a Run already watched
   * does nothing. `shown: false` is for a Run watched in the background (a
   * list keeping its statuses live): it does not count as opened, so it
   * never pushes the Run on screen out of the ended Runs kept.
   */
  open(runId: string, { shown = true }: { shown?: boolean } = {}) {
    if (shown) {
      this.openCount += 1;
      this.opened.set(runId, this.openCount);
      this.lastOpened = runId;
    }
    const known = this.entries.get(runId);
    if (known && (this.controllers.has(runId) || known.state === "ended")) {
      return;
    }
    this.watch(runId);
  }

  /** Reads the Run afresh and watches it again: the Retry after an error. */
  retry(runId: string) {
    this.controllers.get(runId)?.abort();
    this.controllers.delete(runId);
    this.watch(runId);
  }

  /** Takes a Run a write just returned (an Approval, a Stop) as the newest word, and keeps watching if it is still at work. */
  adopt(run: RunView) {
    const current = this.entries.get(run.id);
    if (!current?.run || run.updatedAt >= current.run.updatedAt) {
      this.set(run.id, {
        runId: run.id,
        run,
        state: current?.state ?? "live",
        error: null,
        gone: false,
      });
    }
    if (isRunActive(run.status)) this.open(run.id);
    else this.finish(run.id);
  }

  /** Resolves once the Run has been read for the first time (or has failed to be). */
  whenLoaded(runId: string): Promise<RunWatch | undefined> {
    const current = this.entries.get(runId);
    if (current && current.state !== "loading") return Promise.resolve(current);
    return new Promise((resolve) => {
      const waiters = this.loaded.get(runId) ?? new Set();
      waiters.add(() => resolve(this.entries.get(runId)));
      this.loaded.set(runId, waiters);
    });
  }

  private async watch(runId: string) {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const { signal } = controller;
    const mine = () => this.controllers.get(runId) === controller;
    const existing = this.entries.get(runId);
    this.set(runId, {
      runId,
      run: existing?.run ?? null,
      state: existing?.run ? "live" : "loading",
      error: null,
      gone: false,
    });

    let shadow: RunView | null = null;
    let from = 0;
    let caughtUp = false;
    let failures = 0;
    let needGet = !existing?.run;

    const lost = async (): Promise<boolean> => {
      failures += 1;
      if (failures > MAX_RECONNECTS) {
        throw new Error("The live view lost its connection to the Run.");
      }
      this.patch(runId, { state: "reconnecting" });
      await this.sleep(backoffMs(failures - 1), signal);
      return mine() && !signal.aborted;
    };

    try {
      for (;;) {
        // 1. Where the Run stands now.
        if (needGet) {
          let run: RunView;
          try {
            run = await this.source.get(runId);
          } catch (caught) {
            if (!mine() || signal.aborted) return;
            if (
              isGone(caught) ||
              (failures === 0 && !this.entries.get(runId)?.run)
            ) {
              throw caught;
            }
            if (!(await lost())) return;
            continue;
          }
          if (!mine()) return;
          this.publish(runId, run, "live");
          needGet = false;
          // After a drop the new snapshot is the base the tail applies to.
          if (from > 0) {
            shadow = run;
            caughtUp = true;
          }
        }
        const base = this.entries.get(runId)?.run;
        if (base && !isRunActive(base.status)) return this.finish(runId);

        // 2. Its stream, from where we left off.
        const openedAt = Date.now();
        try {
          for await (const event of this.source.events(runId, from, signal)) {
            if (!mine()) return;
            failures = 0;
            from = event.seq + 1;
            const published = this.entries.get(runId)?.run ?? null;
            // A stream from the start opens with `run.started`, which sets
            // every Step to pending; hold it back until it has caught up with
            // what `get` already showed, so the Run never draws going backwards.
            shadow = reduceRun(shadow, event);
            if (!shadow) continue;
            if (
              caughtUp ||
              !published ||
              event.type === "run.finished" ||
              Date.now() - openedAt > REPLAY_GRACE_MS ||
              runProgress(shadow) >= runProgress(published)
            ) {
              caughtUp = true;
              this.publish(runId, shadow, "live");
            }
            if (event.type === "run.finished") return this.finish(runId);
          }
        } catch (caught) {
          if (!mine() || signal.aborted) return;
          if (isGone(caught)) throw caught;
        }
        if (!mine() || signal.aborted) return;

        // The stream ended. A Run still at work means it dropped.
        const now = this.entries.get(runId)?.run;
        if (now && !isRunActive(now.status)) return this.finish(runId);
        needGet = true;
        if (!(await lost())) return;
      }
    } catch (caught) {
      if (!mine()) return;
      this.patch(runId, {
        state: "error",
        error:
          caught instanceof Error && caught.message
            ? caught.message
            : "The Run did not load.",
        gone: isGone(caught),
      });
      this.controllers.delete(runId);
      this.wake(runId);
    }
  }

  private publish(runId: string, run: RunView, state: WatchState) {
    this.set(runId, {
      runId,
      run,
      state: isRunActive(run.status) ? state : "ended",
      error: null,
      gone: false,
    });
    this.wake(runId);
  }

  private finish(runId: string) {
    this.controllers.delete(runId);
    this.patch(runId, { state: "ended" });
    this.wake(runId);
    this.trim();
  }

  /** Drops the least recently opened ended Runs past `maxEnded`, never the one opened last. */
  private trim() {
    const ended = [...this.entries.values()]
      .filter(
        (watch) =>
          watch.state === "ended" && !this.controllers.has(watch.runId),
      )
      .map((watch) => watch.runId);
    const extra = ended.length - this.maxEnded;
    if (extra <= 0) return;
    const drop = ended
      .filter((runId) => runId !== this.lastOpened)
      .sort((a, b) => (this.opened.get(a) ?? 0) - (this.opened.get(b) ?? 0))
      .slice(0, extra);
    if (drop.length === 0) return;
    const next = new Map(this.entries);
    for (const runId of drop) {
      next.delete(runId);
      this.opened.delete(runId);
    }
    this.entries = next;
    for (const listener of this.listeners) listener();
  }

  private wake(runId: string) {
    const waiters = this.loaded.get(runId);
    if (!waiters) return;
    this.loaded.delete(runId);
    for (const wake of waiters) wake();
  }

  private patch(runId: string, change: Partial<RunWatch>) {
    const current = this.entries.get(runId);
    if (current) this.set(runId, { ...current, ...change });
  }

  private set(runId: string, watch: RunWatch) {
    const next = new Map(this.entries);
    next.set(runId, watch);
    this.entries = next;
    for (const listener of this.listeners) listener();
  }
}
