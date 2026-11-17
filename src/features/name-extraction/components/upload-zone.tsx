"use client";

import { motion, useReducedMotion } from "motion/react";
import { type Ref, useId, useRef, useState } from "react";
import { SOFT } from "./motion-kit";
import { cx, friendly } from "./ui";
import { MAX_PAGES, type UploadProgress, uploadPdf } from "./upload";

export type Uploaded = { uploadId: string; title: string; pages: number };

function progressText(progress: UploadProgress | null) {
  if (!progress) return null;
  if (progress.stage === "reading")
    return `Reading page ${progress.done + 1} of ${progress.total}…`;
  if (progress.stage === "uploading") return "Sending the text…";
  return "Ready.";
}

/**
 * Drop a PDF (or choose one): its text is read here in the browser, only the
 * text is uploaded, and the document opens. One upload at a time; progress
 * and errors show in the zone itself.
 */
export function UploadZone({
  onUploaded,
  inputRef,
}: {
  onUploaded: (upload: Uploaded) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const pages = useRef(0);

  const take = async (file: File | undefined) => {
    if (!file || busy.current) return;
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("That isn't a PDF. Sieve reads PDFs with a text layer.");
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const uploadId = await uploadPdf(file, (next) => {
        if (next.stage === "reading") pages.current = next.total;
        setProgress(next);
      });
      onUploaded({
        uploadId,
        title: file.name.replace(/\.pdf$/i, "").slice(0, 120) || "Upload",
        pages: pages.current,
      });
    } catch (caught) {
      setError(friendly(caught, "The upload didn't go through."));
    } finally {
      busy.current = false;
      setPending(false);
      setProgress(null);
    }
  };

  const share =
    progress?.stage === "reading" && progress.total > 0
      ? progress.done / progress.total
      : progress
        ? 1
        : 0;

  return (
    <label
      htmlFor={`${id}-file`}
      data-over={over}
      aria-busy={pending || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void take(event.dataTransfer.files[0]);
      }}
      className={cx(
        "sv-drop group relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-sm border-2 border-dashed px-6 py-8 text-center shadow-hard-sm transition-colors",
        "focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-federal-blue",
        over
          ? "border-federal-blue bg-morning-haze"
          : "border-ink bg-paper/70 hover:bg-paper",
        pending && "cursor-progress",
      )}
    >
      <motion.span
        aria-hidden="true"
        animate={
          reduce
            ? undefined
            : over
              ? { y: -8, rotate: -4, scale: 1.08 }
              : { y: [0, -4, 0], rotate: 0, scale: 1 }
        }
        transition={
          over
            ? SOFT
            : {
                duration: 3,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }
        }
        className="relative flex h-16 w-12 flex-col gap-1 rounded-[2px] border-2 border-ink bg-paper p-1.5 shadow-hard-sm"
      >
        <span className="h-1 w-3/4 bg-ink" />
        <span className="h-[3px] w-full bg-ink/20" />
        <span className="h-[3px] w-4/5 bg-ink/20" />
        <span className="h-[3px] w-full bg-brass" />
        <span className="h-[3px] w-2/3 bg-ink/20" />
        <span className="absolute -right-2 -bottom-2 flex size-6 items-center justify-center rounded-sm border-2 border-ink bg-brass font-mono text-sm font-bold">
          ↑
        </span>
      </motion.span>
      <span className="font-mono text-base font-bold uppercase">
        {pending ? (progressText(progress) ?? "Opening…") : "Drop your own PDF"}
      </span>
      <span className="max-w-xs text-sm text-ink-muted">
        {pending
          ? "Only the text leaves your browser."
          : `or click to choose one · up to ${MAX_PAGES} pages · the text is read in your browser`}
      </span>
      {pending ? (
        <span className="h-2 w-48 overflow-hidden rounded-sm border-2 border-ink bg-paper">
          <motion.span
            className="block h-full origin-left bg-federal-blue"
            animate={{ scaleX: share }}
            transition={SOFT}
          />
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-sm font-medium text-seal-red">
          {error}
        </span>
      ) : null}
      <input
        ref={inputRef}
        id={`${id}-file`}
        type="file"
        accept="application/pdf,.pdf"
        disabled={pending}
        className="sr-only"
        onChange={(event) => {
          void take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}
