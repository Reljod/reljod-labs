"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { SourceIngestResponse } from "../../domain/api";
import { api, messageOf, putFile } from "../api";

/**
 * Adding a file to the Knowledge base from the browser: register it (a
 * pending Source and a signed URL), PUT the bytes, then read it into
 * Passages. One file at a time, in the order given. The jobs it keeps are
 * what the upload panel shows; the controller for Demo mode waits on `add`.
 */

export type UploadPhase =
  | "registering"
  | "uploading"
  | "reading"
  | "done"
  | "failed";

export type UploadJob = {
  key: number;
  name: string;
  phase: UploadPhase;
  /** 0 to 1 while uploading. */
  fraction: number;
  sourceId: string | null;
  error: string | null;
  /** Conflicts the new Source raised, once it is read. */
  conflicts: number;
};

export type UploadOutcome =
  | { ok: true; result: SourceIngestResponse }
  | { ok: false; error: string };

const KEEP_JOBS = 5;

export function useUploads(sessionId: string | null) {
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const next = useRef(1);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const files = useRef(new Map<number, File>());

  const patch = useCallback((key: number, change: Partial<UploadJob>) => {
    setJobs((list) =>
      list.map((job) => (job.key === key ? { ...job, ...change } : job)),
    );
  }, []);

  const refresh = useCallback(() => {
    for (const root of ["sources", "source", "conflicts", "search"]) {
      void queryClient.invalidateQueries({ queryKey: ["harness", root] });
    }
  }, [queryClient]);

  /** Reads a registered Source, and records the outcome on its job. Safe to call again. */
  const ingest = useCallback(
    async (key: number, sourceId: string): Promise<UploadOutcome> => {
      patch(key, { phase: "reading", error: null });
      try {
        const result = await api.sources.ingest(sourceId);
        if (result.source.status === "failed") {
          const error = result.source.error ?? "Reading this file failed.";
          patch(key, { phase: "failed", error });
          return { ok: false, error };
        }
        patch(key, { phase: "done", conflicts: result.conflicts.length });
        return { ok: true, result };
      } catch (caught) {
        const error = messageOf(caught);
        patch(key, { phase: "failed", error });
        return { ok: false, error };
      } finally {
        refresh();
      }
    },
    [patch, refresh],
  );

  const run = useCallback(
    async (key: number, file: File): Promise<UploadOutcome> => {
      try {
        const { source, uploadUrl } = await api.sources.uploadUrl({
          name: file.name,
          type: file.type || "application/octet-stream",
          bytes: file.size,
          sessionId,
        });
        patch(key, { phase: "uploading", sourceId: source.id });
        refresh();
        await putFile(uploadUrl, file, (fraction) => patch(key, { fraction }));
        patch(key, { fraction: 1 });
        return await ingest(key, source.id);
      } catch (caught) {
        const error = messageOf(caught);
        patch(key, { phase: "failed", error });
        refresh();
        return { ok: false, error };
      }
    },
    [ingest, patch, refresh, sessionId],
  );

  /** Queues a file. Resolves when it is filed or has failed; never rejects. */
  const add = useCallback(
    (file: File): Promise<UploadOutcome> => {
      const key = next.current++;
      files.current.set(key, file);
      setJobs((list) =>
        [
          ...list,
          {
            key,
            name: file.name,
            phase: "registering" as const,
            fraction: 0,
            sourceId: null,
            error: null,
            conflicts: 0,
          },
        ].slice(-KEEP_JOBS),
      );
      const outcome = chain.current.then(() => run(key, file));
      chain.current = outcome.catch(() => undefined);
      return outcome;
    },
    [run],
  );

  /** Tries a failed job again: reads the Source if it was registered, else sends the file again. */
  const retry = useCallback(
    (key: number): Promise<UploadOutcome> => {
      const job = jobs.find((item) => item.key === key);
      const file = files.current.get(key);
      if (!job)
        return Promise.resolve({ ok: false, error: "Nothing to retry." });
      const outcome = chain.current.then(() =>
        job.sourceId && job.fraction >= 1
          ? ingest(key, job.sourceId)
          : file
            ? run(key, file)
            : Promise.resolve<UploadOutcome>({
                ok: false,
                error: "Choose the file again.",
              }),
      );
      chain.current = outcome.catch(() => undefined);
      return outcome;
    },
    [ingest, jobs, run],
  );

  const dismiss = useCallback((key: number) => {
    files.current.delete(key);
    setJobs((list) => list.filter((job) => job.key !== key));
  }, []);

  const busy = jobs.some(
    (job) => job.phase !== "done" && job.phase !== "failed",
  );
  return { jobs, busy, add, retry, dismiss };
}
