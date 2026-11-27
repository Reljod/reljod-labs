import type { RunEventInput } from "../../domain/contract";
import type { TrailStore } from "../ports";

/**
 * Writing a Run's Trail. `emit` is best effort in production: the work an
 * event records has already happened, and failing the Run because the insert
 * failed would lose the work and still not record it. Outside production it
 * throws, so a schema drift is seen at once. `emitStrict` always throws, for
 * work that must not happen untraced (code the driver wrote): write first,
 * and do the work only if it returned.
 */
export function createTrail(store: TrailStore) {
  return {
    async emit(runId: string, ...events: RunEventInput[]) {
      try {
        await store.append(runId, events);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") throw error;
        console.error(
          "[operator] event write failed",
          events.map((event) => event.type).join(","),
          error,
        );
      }
    },
    async emitStrict(runId: string, ...events: RunEventInput[]) {
      await store.append(runId, events);
    },
  };
}
