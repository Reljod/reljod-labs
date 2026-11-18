"use client";

import { useEffect, useMemo } from "react";
import type { DocumentMeta } from "../../domain/document";
import type { Frames, FrameUrls } from "../../domain/frames";
import type { RunView } from "../../domain/run";
import { sampleBySlug } from "../../domain/samples";
import { DocumentView } from "../document-view";
import { exportName } from "../download";
import { frameTimes } from "../frame-times";
import { Skeleton } from "../ui";
import { checksLine } from "./checks-list";
import { ExportButton } from "./export-button";

/** The DOCX builder (and fflate) load only when a download is near. */
const loadDocx = () => import("../../domain/docx");
const prepareDocx = () => void loadDocx().catch(() => {});

/** The Recording's name as the person knows it. */
export function recordingName(run: Pick<RunView, "source" | "title">): string {
  return run.source.kind === "sample"
    ? (sampleBySlug(run.source.slug)?.title ?? run.title)
    : run.source.name;
}

/** What the workflow document says about itself. */
export function documentMeta(run: RunView): DocumentMeta {
  return {
    recordingName: recordingName(run),
    generatedAt: run.completedAt ?? run.createdAt,
    status: "draft",
    checksSummary:
      run.processChecks.length > 0 ? checksLine(run.processChecks) : null,
  };
}

/**
 * The workflow document, laid out by rule from the Process, with its stills
 * and a DOCX download. Built in the browser; nothing is uploaded.
 */
export function DocumentPanel({
  run,
  urls,
  capture,
  progress,
  onSeek,
}: {
  run: RunView;
  urls: FrameUrls;
  capture: (times: number[]) => Promise<Frames>;
  progress: { done: number; total: number };
  onSeek: (seconds: number) => void;
}) {
  const process = run.process;
  const times = useMemo(() => frameTimes(process, []), [process]);
  const meta = useMemo(() => documentMeta(run), [run]);

  // Stills for the preview are captured once the Process exists.
  useEffect(() => {
    if (times.length > 0) void capture(times);
  }, [times, capture]);

  if (!process) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          The document is written by rule from the Process, once Extract and
          Verify have finished.
        </p>
        <Skeleton lines={6} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-muted">
          Laid out by rule: the same Process always gives the same document.
          Times in the document link back to the Recording.
        </p>
        <ExportButton
          runId={run.id}
          kind="docx"
          label="Download .docx"
          fileName={exportName(process.title, "docx")}
          times={times}
          capture={capture}
          progress={progress}
          prepare={prepareDocx}
          build={async (captured) =>
            (await loadDocx()).buildDocx(process, { frames: captured, meta })
          }
        />
      </div>
      <div className="min-w-0 overflow-x-auto">
        <DocumentView
          process={process}
          meta={meta}
          frames={urls}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
}
