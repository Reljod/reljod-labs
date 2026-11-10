import { getWritable } from "workflow";
import type { RunEvent, RunEventInput } from "../domain/run-events";

/** Streams one event to whoever watches the Run. Call from a step only. */
export async function emit(event: RunEventInput) {
  const writer = getWritable<RunEvent>().getWriter();
  try {
    await writer.write({ ...event, at: Date.now() } as RunEvent);
  } finally {
    writer.releaseLock();
  }
}

export async function emitAll(events: RunEventInput[]) {
  const writer = getWritable<RunEvent>().getWriter();
  try {
    for (const event of events) {
      await writer.write({ ...event, at: Date.now() } as RunEvent);
    }
  } finally {
    writer.releaseLock();
  }
}
