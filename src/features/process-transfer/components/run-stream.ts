import { applyEvent, type RunEvent, type RunView } from "../domain/run";

/*
 * The pure half of following a Run's event stream, kept apart from the hook
 * so it can be tested without a network.
 */

/** Whether a streamed line is an event; anything else is counted and skipped, not fatal. */
export function isEvent(value: unknown): value is RunEvent {
  return (
    Boolean(value) && typeof value === "object" && "type" in (value as object)
  );
}

/**
 * Folds one event in. The stream of the Run's current workflow is replayed
 * from its first event onto the saved Run, whose logs already hold the lines
 * written so far (and those of earlier workflows, before a Redo), so a log
 * line the Run already has is not added twice. Calls are de-duplicated by id
 * in `applyEvent`, and patches overwrite.
 */
export function foldEvent(run: RunView, event: RunEvent): RunView {
  if (
    event.type === "log" &&
    run.logs.some(
      (line) =>
        line.at === event.at &&
        line.level === event.level &&
        line.text === event.text,
    )
  ) {
    return run;
  }
  return applyEvent(run, event);
}

/**
 * A Run is followed until its stream closes right after an `end`; a stream
 * that closes without one (a timeout, a deploy) is picked up again with
 * `from`. A Redo starts a new workflow, whose stream starts from 0 again.
 */
export function finished(lastEvent: RunEvent | null): boolean {
  return lastEvent?.type === "end";
}

/** Wait before reconnect attempt `attempt` (0-based): 1 s, 2 s, 4 s, capped at 8 s. */
export function backoff(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** Math.max(0, attempt));
}

/**
 * Failures in a row after one connection to the stream, which drives the
 * backoff and the "lost" state. A connection that delivered new lines
 * resets the count (a dropped one counts as the first failure again). One
 * that delivered nothing counts as a failure even when it closed cleanly: a
 * workflow that died leaves its stream closing at once, forever.
 */
export function failuresAfter(
  failures: number,
  attempt: { delivered: number; threw: boolean },
): number {
  if (attempt.delivered > 0) return attempt.threw ? 1 : 0;
  return failures + 1;
}

/** Wait before the next connection: a beat after a healthy one, else the backoff. */
export function waitBefore(failures: number): number {
  return failures > 0 ? backoff(failures - 1) : 300;
}
