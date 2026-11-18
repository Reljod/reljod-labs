import "server-only";
import type { TrailEventInput } from "../domain/contract";
import { insertEvents } from "./repository";

/**
 * Appends events to an Examination's Trail. Best effort: the work an event
 * records has already happened, and failing the Examination because the
 * Trail's insert failed would lose the work and still not record it. Outside
 * production it throws, so a schema drift is seen at once.
 */
export async function emit(examinationId: string, ...events: TrailEventInput[]) {
  if (events.length === 0) return;
  try {
    await insertEvents(examinationId, events);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") throw error;
    console.error(
      "[loupe] event write failed",
      events.map((event) => event.type).join(","),
      error,
    );
  }
}

/**
 * Appends events and throws if it cannot, in production too. For work that
 * must not happen untraced (code in the Sandbox): write first, and do the
 * work only if this returned.
 */
export async function emitStrict(
  examinationId: string,
  ...events: TrailEventInput[]
) {
  await insertEvents(examinationId, events);
}
