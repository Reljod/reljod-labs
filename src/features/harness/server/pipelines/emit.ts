import "server-only";
import { getWritable } from "workflow";
import type { RunEvent, RunEventInput } from "../../domain/run";

/**
 * Streams events to whoever watches the Run. Call from a step only.
 *
 * Steps that run at the same time write to the one stream, so no step can
 * know an event's place in it. Events are written with `seq: -1`; the reader
 * (`runEventsStream`) numbers each one by its index in the stream, which is
 * exactly what `?from=` resumes at.
 */
export async function emit(...events: RunEventInput[]) {
  if (events.length === 0) return;
  const writer = getWritable<RunEvent>().getWriter();
  try {
    for (const event of events) {
      await writer.write({
        ...event,
        seq: -1,
        at: new Date().toISOString(),
      } as RunEvent);
    }
  } finally {
    writer.releaseLock();
  }
}

/** Ends the stream: call once, after `run.finished`. */
export async function closeStream() {
  await getWritable<RunEvent>().close();
}
