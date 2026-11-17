"use client";

import { useId, useRef, useState } from "react";
import { ACCEPT, ACCEPTED_LABEL } from "../../domain/knowledge/file-kind";
import { KNOWLEDGE_SAMPLES } from "../../domain/samples/knowledge";
import { Badge, Button, cx, ErrorNote, Panel, Spinner, useWrite } from "../ui";
import type { UploadJob } from "./use-uploads";

const PHASE_LABEL: Record<UploadJob["phase"], string> = {
  registering: "Attaching…",
  uploading: "Uploading…",
  reading: "Reading and checking for Conflicts…",
  done: "Filed",
  failed: "Failed",
};

/**
 * Adds a file: a drop zone, a button, and a sample to try. Each file goes
 * pending → reading → filed, with the step shown where it was started. A file
 * that fails keeps its message and a Try again.
 */
export function UploadPanel({
  jobs,
  busy,
  disabledReason,
  onFiles,
  onSample,
  onRetry,
  onDismiss,
  onOpen,
}: {
  jobs: UploadJob[];
  busy: boolean;
  /** Why the Staff member may not add a Source, or null when they may. */
  disabledReason: string | null;
  onFiles: (files: File[]) => void;
  onSample: (sampleId: string) => Promise<void>;
  onRetry: (key: number) => void;
  onDismiss: (key: number) => void;
  onOpen: (sourceId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const sampleId = useId();
  const [dragging, setDragging] = useState(false);
  const [sample, setSample] = useState(KNOWLEDGE_SAMPLES[0]?.id ?? "");
  const useSample = useWrite(async () => {
    if (!sample) return;
    await onSample(sample);
  });
  const locked = disabledReason !== null;
  const chosen = KNOWLEDGE_SAMPLES.find((item) => item.id === sample);

  return (
    <Panel
      eyebrow="Add to the Knowledge base"
      title="Add a Source"
      bodyClassName="space-y-3 p-3"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button inside does the same for the keyboard */}
      <div
        onDragOver={(event) => {
          if (locked) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (locked || busy) return;
          const dropped = [...event.dataTransfer.files];
          if (dropped.length > 0) onFiles(dropped);
        }}
        className={cx(
          "flex flex-col items-center gap-2 rounded-sm border-2 border-dashed px-3 py-5 text-center",
          dragging
            ? "border-federal-blue bg-morning-haze"
            : "border-ink bg-marble",
        )}
      >
        <p className="text-sm text-ink-muted">
          Drop {ACCEPTED_LABEL} files here, or
        </p>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          disabled={locked || busy}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            event.target.value = "";
            if (picked.length > 0) onFiles(picked);
          }}
        />
        <Button
          variant="primary"
          size="sm"
          pending={busy}
          pendingLabel="Adding…"
          disabled={locked}
          onClick={() => input.current?.click()}
        >
          Choose files
        </Button>
        {locked ? (
          <p className="text-xs text-ink-muted">{disabledReason}</p>
        ) : (
          <p className="text-xs text-ink-muted">
            Up to 10 MB each. A file is attached first, then read into Passages;
            it is searchable once it is filed.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={sampleId}
          className="eyebrow text-[0.65rem] text-ink-muted"
        >
          Or use a sample
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={sampleId}
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            disabled={locked || useSample.pending || busy}
            className="h-9 min-w-0 flex-1 rounded-sm outline-box bg-paper px-2 text-sm text-ink focus-visible:border-federal-blue focus-visible:outline-2 focus-visible:outline-federal-blue/30 disabled:bg-marble disabled:text-ink-muted"
          >
            {KNOWLEDGE_SAMPLES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <Button
            size="md"
            pending={useSample.pending}
            pendingLabel="Adding…"
            disabled={locked || busy || !sample}
            onClick={() => void useSample.run()}
          >
            Add sample
          </Button>
        </div>
        {chosen ? (
          <p className="text-xs text-ink-muted">{chosen.about}</p>
        ) : null}
        <ErrorNote>{useSample.error}</ErrorNote>
      </div>

      {jobs.length > 0 ? (
        <ul className="space-y-2" aria-label="Uploads">
          {jobs.map((job) => (
            <li
              key={job.key}
              className="rounded-sm outline-box bg-paper px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {job.name}
                </span>
                {job.phase === "done" ? (
                  <Badge tone="green">Filed</Badge>
                ) : job.phase === "failed" ? (
                  <Badge tone="red">Failed</Badge>
                ) : (
                  <Badge tone="blue" dot>
                    {job.phase === "reading" ? "Reading" : "Adding"}
                  </Badge>
                )}
              </div>
              {job.phase === "uploading" ? (
                <progress
                  className="mt-2 h-1.5 w-full"
                  max={1}
                  value={job.fraction}
                  aria-label={`Uploading ${job.name}`}
                />
              ) : null}
              <p
                className="mt-1 flex items-center gap-2 text-xs text-ink-muted"
                aria-live="polite"
              >
                {job.phase !== "done" && job.phase !== "failed" ? (
                  <Spinner />
                ) : null}
                <span>
                  {job.phase === "done"
                    ? job.conflicts > 0
                      ? `Filed. ${job.conflicts} Conflict${job.conflicts === 1 ? "" : "s"} to settle.`
                      : "Filed. No Conflicts with what is already there."
                    : PHASE_LABEL[job.phase]}
                </span>
              </p>
              {job.error ? (
                <ErrorNote className="mt-2">{job.error}</ErrorNote>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {job.sourceId && job.phase === "done" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onOpen(job.sourceId as string)}
                  >
                    Open
                  </Button>
                ) : null}
                {job.phase === "failed" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onRetry(job.key)}
                  >
                    Try again
                  </Button>
                ) : null}
                {job.phase === "done" || job.phase === "failed" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDismiss(job.key)}
                  >
                    Dismiss
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
