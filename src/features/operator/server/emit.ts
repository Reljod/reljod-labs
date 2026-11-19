import "server-only";
import type { RunEventInput } from "../domain/contract";
import { insertEvents } from "./repository";

/**
 * Appends events to a Run's Trail. Best effort in production: the work an
 * event records has already happened, and failing the Run because the insert
 * failed would lose the work and still not record it. Outside production it
 * throws, so a schema drift is seen at once.
 */
export async function emit(runId: string, ...events: RunEventInput[]) {
  try {
    await insertEvents(runId, events);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") throw error;
    console.error(
      "[operator] event write failed",
      events.map((event) => event.type).join(","),
      error,
    );
  }
}

/**
 * Appends events and throws if it cannot, in production too. For work that
 * must not happen untraced (code the driver wrote): write first, and do the
 * work only if this returned.
 */
export async function emitStrict(runId: string, ...events: RunEventInput[]) {
  await insertEvents(runId, events);
}
