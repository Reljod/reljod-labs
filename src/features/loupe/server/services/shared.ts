import type { TrailEventInput } from "../../domain/contract";
import type { ExaminationRow } from "../examination";
import type { LoupePorts, Seed } from "../ports";

/** What every Loupe service shares: Trail writes and an Examination's Document. */
export type Shared = {
  /**
   * Appends events to an Examination's Trail. Best effort: the work an event
   * records has already happened, and failing the Examination because the
   * Trail's insert failed would lose the work and still not record it.
   * Outside production it throws, so a schema drift is seen at once.
   */
  emit(examinationId: string, ...events: TrailEventInput[]): Promise<void>;
  /**
   * Appends events and throws if it cannot, in production too. For work that
   * must not happen untraced (code in the Sandbox): write first, and do the
   * work only if this returned.
   */
  emitStrict(
    examinationId: string,
    ...events: TrailEventInput[]
  ): Promise<void>;
  /**
   * The Document of an Examination as a file for the Sandbox: a Sample's
   * (hash checked) or the Owner's Upload from the private bucket. The Upload
   * is read through the Examination's own Owner, never another's.
   */
  documentOf(
    row: Pick<ExaminationRow, "owner" | "source">,
    origin: string,
  ): Seed;
};

export function createShared(
  ports: Pick<
    LoupePorts,
    "trail" | "uploads" | "store" | "samples" | "strictTrail"
  >,
): Shared {
  const { trail, uploads, store, samples } = ports;
  return {
    async emit(examinationId, ...events) {
      if (events.length === 0) return;
      try {
        await trail.append(examinationId, events);
      } catch (error) {
        if (ports.strictTrail) throw error;
        console.error(
          "[loupe] event write failed",
          events.map((event) => event.type).join(","),
          error,
        );
      }
    },

    emitStrict: (examinationId, ...events) =>
      trail.append(examinationId, events),

    documentOf(row, origin) {
      return async () => {
        if (row.source.kind === "sample") {
          const sample = await samples(row.source.sampleId, origin);
          return { bytes: sample.bytes, fileName: sample.file };
        }
        const upload = await uploads.owned(row.owner, row.source.uploadId);
        if (!upload) throw new Error("The Upload is gone.");
        const bytes = await store.download(upload.storage_path);
        if (!bytes) throw new Error("The Upload's file was never received.");
        return { bytes, fileName: upload.storage_path };
      };
    },
  };
}
