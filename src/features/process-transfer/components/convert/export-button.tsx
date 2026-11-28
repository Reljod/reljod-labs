"use client";

import { useRef, useState } from "react";
import { type Frames, frameKey } from "../../domain/frames";
import type { ExportKind } from "../../domain/run";
import { recordExport } from "../api";
import { saveFile } from "../download";
import { buttonClass, InlineError, InlineNote, quietButtonClass } from "../ui";

type Phase =
  | { at: "idle" }
  | { at: "frames"; done: number; total: number }
  | { at: "building" }
  | { at: "recording" }
  | { at: "done"; name: string; frames: number }
  | { at: "failed"; error: string };

/**
 * Builds a file in the browser and saves it: capture the stills it needs,
 * build, record the download (the server refuses a PPTX whose Deck is not
 * approved), then save. Sends once; says what happened under the button.
 */
export function ExportButton({
  runId,
  kind,
  label,
  fileName,
  times,
  capture,
  progress,
  build,
  prepare,
  disabledReason = null,
  primary = true,
}: {
  runId: string;
  kind: ExportKind;
  label: string;
  fileName: string;
  /** The Recording times this file shows. */
  times: number[];
  capture: (times: number[]) => Promise<Frames>;
  /** Live capture progress from `useFrames`. */
  progress: { done: number; total: number };
  /** Builds the file; may load the builder's code first. */
  build: (frames: Frames) => Uint8Array | Promise<Uint8Array>;
  /** Starts loading what `build` needs, on hover or focus. */
  prepare?: () => void;
  /** Why the button is off, shown beside it. */
  disabledReason?: string | null;
  primary?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const busy = useRef(false);
  const working =
    phase.at === "frames" ||
    phase.at === "building" ||
    phase.at === "recording";

  const onClick = async () => {
    if (busy.current || disabledReason) return;
    busy.current = true;
    try {
      setPhase({ at: "frames", done: 0, total: times.length });
      const frames = await capture(times);
      setPhase({ at: "building" });
      // Let the label paint before the synchronous build holds the thread.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const bytes = await build(frames);
      setPhase({ at: "recording" });
      const result = await recordExport(runId, kind);
      if (!result.ok) {
        setPhase({ at: "failed", error: result.error });
        return;
      }
      saveFile(bytes, fileName, kind);
      const shown = times.filter((at) =>
        Object.hasOwn(frames, frameKey(at)),
      ).length;
      setPhase({ at: "done", name: fileName, frames: shown });
    } catch (error) {
      setPhase({
        at: "failed",
        error:
          error instanceof Error && error.message
            ? `The file could not be built: ${error.message}`
            : "The file could not be built.",
      });
    } finally {
      busy.current = false;
    }
  };

  const pendingLabel =
    phase.at === "frames"
      ? progress.total > 0
        ? `Capturing stills ${progress.done}/${progress.total}…`
        : "Capturing stills…"
      : phase.at === "building"
        ? "Building…"
        : phase.at === "recording"
          ? "Saving…"
          : null;

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={onClick}
        onPointerEnter={prepare}
        onFocus={prepare}
        disabled={working || Boolean(disabledReason)}
        aria-busy={working}
        aria-describedby={disabledReason ? `${runId}-${kind}-why` : undefined}
        className={primary ? buttonClass : quietButtonClass}
      >
        <DownloadGlyph />
        {pendingLabel ?? label}
      </button>
      {disabledReason ? (
        <p
          id={`${runId}-${kind}-why`}
          className="max-w-prose text-sm text-ink-muted"
        >
          {disabledReason}
        </p>
      ) : null}
      {phase.at === "done" ? (
        <InlineNote>
          Saved {phase.name}
          {times.length > 0
            ? phase.frames > 0
              ? `, with ${phase.frames} still${phase.frames === 1 ? "" : "s"} from the Recording.`
              : ", without stills: the Recording could not be read in this browser."
            : "."}
        </InlineNote>
      ) : null}
      {phase.at === "failed" ? <InlineError>{phase.error}</InlineError> : null}
    </div>
  );
}

function DownloadGlyph() {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="square"
    >
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
