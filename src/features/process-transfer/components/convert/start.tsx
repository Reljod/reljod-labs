"use client";

import Image from "next/image";
import { type DragEvent, useEffect, useRef, useState } from "react";
import type { DeskView } from "../../domain/run";
import { SAMPLES, type Sample } from "../../domain/samples";
import { createUpload, startRun } from "../../server/actions";
import { bytes, seconds, usdCents } from "../format";
import {
  buttonClass,
  focusRing,
  InlineError,
  linkButtonClass,
  quietButtonClass,
} from "../ui";
import {
  ACCEPT,
  durationProblem,
  fileProblem,
  putFile,
  readDuration,
  videoType,
} from "./upload";

/**
 * Why new work will probably be refused now, from the Owner's spend. Shown as
 * a warning only: the server decides (and may let trusted sessions through),
 * and its refusal is shown where the person clicked.
 */
export function capProblem(spend: DeskView["spend"]): string | null {
  if (spend.todayUsd >= spend.capUsd) {
    return `Your Runs have cost ${usdCents(spend.todayUsd)} today, the demo's daily cap, so a new Run will likely be refused until tomorrow. Past Runs stay open.`;
  }
  if (spend.runsLeftThisHour <= 0) {
    return "You have used this hour's Runs, so a new one will likely be refused for a little while. Past Runs stay open.";
  }
  return null;
}

/**
 * The Convert tab with no Run open: pick a Sample Recording or upload one,
 * then start a Run. Each start sends once and shows its error where it was
 * clicked.
 */
export function StartScreen({
  desk,
  onStarted,
}: {
  desk: DeskView;
  onStarted: (runId: string) => void;
}) {
  const [picked, setPicked] = useState<Sample | null>(null);
  const blocked = capProblem(desk.spend);

  return (
    <div className="flex flex-col gap-8">
      {picked ? (
        <SamplePreview
          sample={picked}
          blocked={blocked}
          onBack={() => setPicked(null)}
          onStarted={onStarted}
        />
      ) : (
        <>
          <Intro />
          {blocked ? (
            <p className="outline-box rounded-sm bg-brass/25 px-4 py-3 text-sm font-medium">
              {blocked}
            </p>
          ) : null}
          <section aria-labelledby="ho-samples" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="eyebrow text-ink-muted">Sample Recordings</p>
                <h2
                  id="ho-samples"
                  className="font-mono text-lg font-bold tracking-[0.04em] uppercase"
                >
                  Pick a handover call
                </h2>
              </div>
              <p className="max-w-md text-sm text-ink-muted">
                Twelve short calls from the fictional Meridian Bank &amp; Trust.
                Every name and number is made up.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {SAMPLES.map((sample) => (
                <li key={sample.slug} className="min-w-0">
                  <SampleCard
                    sample={sample}
                    onPick={() => setPicked(sample)}
                  />
                </li>
              ))}
            </ul>
          </section>
          <UploadZone desk={desk} onStarted={onStarted} />
        </>
      )}
    </div>
  );
}

function Intro() {
  const steps = [
    ["Watch", "A model watches the call and reads the shared screen."],
    [
      "Write",
      "The steps are written up, each linked to its second in the Recording.",
    ],
    [
      "Check",
      "Rules and a second model check the work; the Deck is revised until it passes.",
    ],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {steps.map(([title, text], index) => (
        <div
          key={title}
          className="flex gap-3 rounded-sm border-ink/15 border-l-4 bg-paper/70 px-3 py-2"
        >
          <span className="font-mono text-xs font-bold text-federal-blue">
            0{index + 1}
          </span>
          <p className="text-sm">
            <span className="font-semibold">{title}.</span> {text}
          </p>
        </div>
      ))}
    </div>
  );
}

/** A Sample's poster, or a plain card when the still is missing. */
function Poster({
  sample,
  sizes,
  priority = false,
}: {
  sample: Sample;
  sizes: string;
  priority?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-ink">
      {broken ? (
        <div className="flex h-full flex-col justify-end gap-1 bg-[linear-gradient(135deg,var(--color-federal-blue),var(--color-ink))] p-4 text-paper">
          <span className="eyebrow text-paper/70">{sample.team}</span>
          <span className="font-mono text-sm font-bold uppercase">
            {sample.title}
          </span>
        </div>
      ) : (
        <Image
          src={sample.poster}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
          onError={() => setBroken(true)}
        />
      )}
      {sample.durationSeconds > 0 ? (
        <span className="absolute right-2 bottom-2 rounded-sm bg-ink/85 px-1.5 py-0.5 font-mono text-[11px] text-paper">
          {seconds(sample.durationSeconds)}
        </span>
      ) : null}
    </div>
  );
}

function SampleCard({
  sample,
  onPick,
}: {
  sample: Sample;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`${sample.title}, ${sample.team}${sample.durationSeconds > 0 ? `, ${seconds(sample.durationSeconds)}` : ""}`}
      className={`outline-box press flex h-full w-full flex-col overflow-hidden rounded-sm bg-paper text-left ${focusRing}`}
    >
      <Poster
        sample={sample}
        sizes="(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw"
      />
      <div className="flex flex-1 flex-col gap-1.5 border-ink border-t-2 p-3">
        <p className="eyebrow text-ink-muted">{sample.team}</p>
        <p className="font-semibold leading-snug">{sample.title}</p>
        <p className="text-sm text-ink-muted">{sample.summary}</p>
      </div>
    </button>
  );
}

function SamplePreview({
  sample,
  blocked,
  onBack,
  onStarted,
}: {
  sample: Sample;
  blocked: string | null;
  onBack: () => void;
  onStarted: (runId: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [videoBroken, setVideoBroken] = useState(false);

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await startRun({ kind: "sample", slug: sample.slug });
      if (result.ok) {
        onStarted(result.runId);
        return;
      }
      setError(result.error);
    } catch {
      setError("The Run could not be started. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const people = [sample.presenter, sample.receiver].filter(Boolean);
  return (
    <div className="ho-in flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className={`${linkButtonClass} self-start text-sm`}
      >
        ← All samples
      </button>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="outline-box overflow-hidden rounded-sm bg-ink shadow-hard-md">
          {videoBroken ? (
            <Poster
              sample={sample}
              sizes="(min-width: 1024px) 60vw, 100vw"
              priority
            />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: synthetic sample calls ship without captions; the Run's transcript is the text version
            <video
              key={sample.slug}
              src={sample.video}
              poster={sample.poster}
              controls
              playsInline
              preload="metadata"
              onError={() => setVideoBroken(true)}
              className="aspect-video w-full bg-ink"
            />
          )}
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <p className="eyebrow text-ink-muted">{sample.team} · Sample</p>
            <h2 className="mt-1 font-mono text-xl font-bold leading-tight tracking-[0.02em] uppercase">
              {sample.title}
            </h2>
          </div>
          <p>{sample.summary}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {people.length > 0 ? (
              <>
                <dt className="eyebrow pt-0.5 text-ink-muted">Handover</dt>
                <dd>{people.join(" → ")}</dd>
              </>
            ) : null}
            {sample.durationSeconds > 0 ? (
              <>
                <dt className="eyebrow pt-0.5 text-ink-muted">Length</dt>
                <dd>{seconds(sample.durationSeconds)}</dd>
              </>
            ) : null}
            {sample.bytes > 0 ? (
              <>
                <dt className="eyebrow pt-0.5 text-ink-muted">Size</dt>
                <dd>{bytes(sample.bytes)}</dd>
              </>
            ) : null}
            <dt className="eyebrow pt-0.5 text-ink-muted">Data</dt>
            <dd>Synthetic: Republic of Meridia, marked SPECIMEN</dd>
          </dl>
          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={start}
              disabled={pending}
              aria-busy={pending}
              className={buttonClass}
            >
              {pending ? "Starting…" : "Convert this recording"}
            </button>
            {blocked ? (
              <p className="text-sm text-ink-muted">{blocked}</p>
            ) : (
              <p className="text-sm text-ink-muted">
                Takes about a minute or two. You can watch every Stage as it
                happens.
              </p>
            )}
            <InlineError>{error}</InlineError>
          </div>
        </div>
      </div>
    </div>
  );
}

type UploadPhase =
  | { at: "idle" }
  | { at: "checking"; name: string }
  | { at: "uploading"; name: string; fraction: number }
  | { at: "starting"; name: string };

function UploadZone({
  desk,
  onStarted,
}: {
  desk: DeskView;
  onStarted: (runId: string) => void;
}) {
  const [phase, setPhase] = useState<UploadPhase>({ at: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const working = phase.at !== "idle";
  const disabled = working;

  // Leaving the screen cancels an upload in flight; nothing starts after it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const send = async (file: File) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const problem = fileProblem(file, desk.limits);
      if (problem) {
        setError(problem);
        return;
      }
      setPhase({ at: "checking", name: file.name });
      const tooLong = durationProblem(await readDuration(file), desk.limits);
      if (tooLong) {
        setError(tooLong);
        return;
      }
      const ticket = await createUpload({
        name: file.name,
        size: file.size,
        type: videoType(file),
      });
      if (!ticket.ok) {
        setError(ticket.error);
        return;
      }
      if (!mounted.current) return;
      setPhase({ at: "uploading", name: file.name, fraction: 0 });
      abort.current = new AbortController();
      await putFile(
        ticket.signedUrl,
        file,
        (fraction) => setPhase({ at: "uploading", name: file.name, fraction }),
        abort.current.signal,
      );
      if (!mounted.current) return;
      setPhase({ at: "starting", name: file.name });
      const result = await startRun({
        kind: "upload",
        path: ticket.path,
        name: file.name,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onStarted(result.runId);
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "The upload did not finish. Try again.",
      );
    } finally {
      abort.current = null;
      busy.current = false;
      setPhase({ at: "idle" });
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) void send(file);
  };

  const status =
    phase.at === "checking"
      ? `Checking ${phase.name}…`
      : phase.at === "uploading"
        ? `Uploading ${phase.name}… ${Math.round(phase.fraction * 100)}%`
        : phase.at === "starting"
          ? "Starting the Run…"
          : null;

  return (
    <section aria-labelledby="ho-upload" className="flex flex-col gap-3">
      <div>
        <p className="eyebrow text-ink-muted">Your own Recording</p>
        <h2
          id="ho-upload"
          className="font-mono text-lg font-bold tracking-[0.04em] uppercase"
        >
          Or upload a call
        </h2>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target; the file button inside is the keyboard path */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-start gap-3 rounded-sm border-2 border-dashed p-5 transition-colors sm:flex-row sm:items-center sm:justify-between ${over ? "border-federal-blue bg-morning-haze" : "border-ink/40 bg-paper/70"}`}
      >
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Drop a screen recording here</p>
          <p className="text-sm text-ink-muted">
            MP4 or MOV, up to {bytes(desk.limits.uploadBytes)} and{" "}
            {seconds(desk.limits.uploadSeconds)}. It is kept private to you. Do
            not upload real customer data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            aria-disabled={disabled}
            className={`${quietButtonClass} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-federal-blue ${disabled ? "pointer-events-none opacity-50" : ""}`}
          >
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              disabled={disabled}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void send(file);
              }}
            />
            {working ? "Working…" : "Choose a file"}
          </label>
          {phase.at === "uploading" ? (
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className={quietButtonClass}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      {status ? (
        <div aria-live="polite" className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{status}</p>
          {phase.at === "uploading" ? (
            <div
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(phase.fraction * 100)}
              className="outline-box h-3 w-full max-w-md overflow-hidden rounded-sm bg-paper"
            >
              <div
                className="h-full bg-federal-blue transition-[width]"
                style={{ width: `${phase.fraction * 100}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <InlineError>{error}</InlineError>
    </section>
  );
}
