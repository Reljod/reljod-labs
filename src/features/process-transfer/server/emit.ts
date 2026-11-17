import "server-only";
import { getWritable } from "workflow";
import type { CheckResult } from "../domain/rules";
import type { RunEvent, RunEventInput, RunLog, RunPatch } from "../domain/run";
import { appendLogs, patchRun } from "./repository";

/** Which Run, and which pass of its pipeline (0, or the Redo it belongs to). */
export type Pass = { runId: string; generation: number };

/**
 * Streams events to whoever watches the Run, and keeps them on its row.
 * All the patches of one call are merged and written in one statement
 * first; when that does not apply (the Run was stopped, failed as stale or
 * redone meanwhile) nothing else is written or streamed and this returns
 * false. Then log lines go to `logs` and every event to the stream, so a
 * finished Run reopens without its stream. Call from a step only.
 */
export async function publish(
  pass: Pass,
  events: RunEventInput[],
  rowOnly: { grounding?: CheckResult | null } = {},
): Promise<boolean> {
  const at = Date.now();
  const stamped = events.map((event) => ({ ...event, at }) as RunEvent);
  const patch: RunPatch = {};
  for (const event of stamped) {
    if (event.type === "patch") Object.assign(patch, event.patch);
  }
  if (!(await patchRun(pass.runId, pass.generation, patch, rowOnly))) {
    return false;
  }
  const logs: RunLog[] = stamped.flatMap((event) =>
    event.type === "log"
      ? [{ at: event.at, level: event.level, text: event.text }]
      : [],
  );
  await appendLogs(pass.runId, pass.generation, logs);
  const writer = getWritable<RunEvent>().getWriter();
  try {
    for (const event of stamped) await writer.write(event);
  } finally {
    writer.releaseLock();
  }
  return true;
}

export function log(
  text: string,
  level: RunLog["level"] = "info",
): RunEventInput {
  return { type: "log", level, text };
}

/** Ends the stream. The last thing a Run's workflow does. */
export async function closeStream() {
  await getWritable<RunEvent>().close();
}
