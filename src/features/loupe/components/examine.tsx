"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { StartRequest } from "../domain/api";
import {
  CHECKS,
  DRIVERS,
  type Driver,
  type ExaminationSummary,
  type Finding,
  KIND_LABELS,
  METRICS,
  MODEL_IDS,
  MODELS,
  type ModelId,
  type SampleCard,
  TAMPER_TYPES,
  VERDICT_LABELS,
  type Verdict,
  WEIGHT_LABELS,
} from "../domain/contract";
import { LIMITS, UPLOAD_TYPES } from "../domain/limits";
import { formatThreshold, ruleSentence } from "../domain/rules";
import {
  createUpload,
  putFile,
  reevaluateExamination,
  runCheckAgain,
  startExamination,
  stopExamination,
} from "./api";
import { type LayerToggles, Stage } from "./stage";
import {
  Button,
  cx,
  ErrorNote,
  fieldClass,
  Panel,
  Spinner,
  Tag,
  type TagTone,
  useWrite,
} from "./ui";
import type { useExamination } from "./use-examination";
import { type ExaminationView, type FeedItem, money, seconds } from "./view";

const VERDICT_TONE: Record<Verdict, { tone: TagTone; box: string }> = {
  genuine: { tone: "green", box: "bg-ivy text-paper" },
  suspicious: { tone: "brass", box: "bg-brass text-ink" },
  tampered: { tone: "red", box: "bg-seal-red text-paper" },
};

// The shelf ------------------------------------------------------------------------

export function Shelf({
  samples,
  examinations,
  currentRulebookVersion,
  onOpen,
  onStarted,
}: {
  samples: SampleCard[];
  examinations: ExaminationSummary[];
  currentRulebookVersion: number;
  onOpen: (examinationId: string) => void;
  onStarted: (examinationId: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(samples[0]?.id ?? null);
  const [driver, setDriver] = useState<Driver>("examiner");
  const [model, setModel] = useState<ModelId>(MODEL_IDS[0]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const sample = samples.find((item) => item.id === picked) ?? null;

  const start = useWrite(async () => {
    setError(null);
    let source: StartRequest["source"];
    if (file) {
      if (!(file.type in UPLOAD_TYPES))
        return setError("Upload a PDF, or a JPEG, PNG or WebP image.");
      if (file.size > LIMITS.uploadBytes)
        return setError(
          `A Document is at most ${Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB.`,
        );
      const opened = await createUpload({
        title: file.name.replace(/\.[^.]+$/, "") || "My document",
        contentType: file.type,
        bytes: file.size,
      });
      if (!opened.ok) return setError(opened.error);
      if (!(await putFile(opened.value.signedUrl, file)))
        return setError("The file could not be uploaded. Try again.");
      source = { kind: "upload", uploadId: opened.value.uploadId };
    } else if (sample) {
      source = { kind: "sample", sampleId: sample.id };
    } else return setError("Pick a Sample or choose a file.");
    const started = await startExamination({ source, driver, model });
    if (!started.ok) return setError(started.error);
    onStarted(started.value.examinationId);
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <Panel
          eyebrow="Step 1"
          title="Pick a document. Nothing here says which ones were altered."
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {samples.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(item.id);
                    setFile(null);
                  }}
                  aria-pressed={!file && picked === item.id}
                  data-testid={`loupe-sample-${item.id}`}
                  className={cx(
                    "outline-box press flex w-full flex-col overflow-hidden rounded-sm bg-paper text-left",
                    !file && picked === item.id && "ring-4 ring-federal-blue",
                  )}
                >
                  {/* biome-ignore lint/performance/noImgElement: static Sample thumbnail with known size. */}
                  <img
                    src={item.pages[0]?.image}
                    alt=""
                    loading="lazy"
                    width={item.pages[0]?.width}
                    height={item.pages[0]?.height}
                    className="aspect-[4/3] w-full border-ink border-b-2 object-cover object-top"
                  />
                  <span className="space-y-1 p-2">
                    <span className="flex flex-wrap gap-1">
                      <Tag tone="blue">{KIND_LABELS[item.kind]}</Tag>
                      <Tag>{item.format === "pdf" ? "PDF" : "Image"}</Tag>
                    </span>
                    <span className="block truncate text-xs font-semibold">
                      {item.issuer}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel eyebrow="Or" title="Bring your own">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept={Object.keys(UPLOAD_TYPES).join(",")}
              className="sr-only"
              data-testid="loupe-file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button onClick={() => fileInput.current?.click()}>
              Choose a PDF or an image
            </Button>
            {file ? (
              <span className="flex items-center gap-2 text-sm">
                <Tag tone="ink">{file.name.slice(0, 40)}</Tag>
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => setFile(null)}
                >
                  remove
                </button>
              </span>
            ) : null}
            <p className="basis-full text-xs text-ink-muted">
              Your file is yours: it goes to a private bucket, is examined in a
              sandbox with no network, and is never used as a sample. Up to{" "}
              {Math.round(LIMITS.uploadBytes / 1024 / 1024)} MB and{" "}
              {LIMITS.maxPages} pages.
            </p>
          </div>
        </Panel>

        {examinations.length ? (
          <Panel eyebrow="Earlier" title="Your Examinations">
            <ul className="divide-y-2 divide-ink/10">
              {examinations.slice(0, 12).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(item.id)}
                    className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-marble"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.title}
                    </span>
                    {item.verdict ? (
                      <Tag tone={VERDICT_TONE[item.verdict].tone}>
                        {VERDICT_LABELS[item.verdict]}
                      </Tag>
                    ) : (
                      <Tag>{item.status}</Tag>
                    )}
                    <Tag>{DRIVERS[item.driver]}</Tag>
                    {item.rulebookVersion !== currentRulebookVersion ? (
                      <Tag tone="brass">Rules v{item.rulebookVersion}</Tag>
                    ) : null}
                    <span className="font-mono text-xs text-ink-muted">
                      {money(item.costUsd)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      <Panel
        eyebrow="Step 2"
        title="Examine it"
        className="self-start xl:sticky xl:top-20"
      >
        <div className="space-y-4">
          <p className="text-sm font-semibold">
            {file ? file.name : (sample?.title ?? "Nothing picked")}
          </p>
          {!file && sample ? (
            <p className="text-xs text-ink-muted">{sample.blurb}</p>
          ) : null}
          <fieldset>
            <legend className="eyebrow mb-1.5 text-[0.65rem] text-ink-muted">
              Who examines
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {(["examiner", "sweep"] as Driver[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDriver(id)}
                  aria-pressed={driver === id}
                  className={cx(
                    "outline-box rounded-sm px-2.5 py-1.5 font-mono text-[0.7rem] font-bold uppercase",
                    driver === id ? "bg-ink text-paper" : "bg-paper",
                  )}
                >
                  {id === "examiner"
                    ? "Examiner + Sweep"
                    : "Sweep only, no model"}
                </button>
              ))}
            </div>
          </fieldset>
          {driver === "examiner" ? (
            <label className="block">
              <span className="eyebrow mb-1.5 block text-[0.65rem] text-ink-muted">
                Examiner's model
              </span>
              <select
                className={fieldClass}
                value={model}
                onChange={(event) => setModel(event.target.value as ModelId)}
              >
                {MODEL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {MODELS[id].label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            variant="primary"
            className="w-full"
            pending={start.pending}
            pendingLabel="Starting…"
            onClick={() => start.run()}
            data-testid="loupe-start"
          >
            Examine this document
          </Button>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <p className="text-xs text-ink-muted">
            The Examiner looks, suspects, then proves it with code in a sandbox.
            Only what code measured becomes a Finding, and Rules decide the
            Verdict. An Examination costs a few cents.
          </p>
        </div>
      </Panel>
    </div>
  );
}

// An open Examination -----------------------------------------------------------------

type Live = ReturnType<typeof useExamination>;

export function Examination({
  live,
  currentRulebookVersion,
  onClose,
  onChanged,
}: {
  live: Live;
  currentRulebookVersion: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { view, detail, id } = live;
  const [pageNumber, setPageNumber] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggles, setToggles] = useState<LayerToggles>({
    boxes: true,
    layers: true,
    hypotheses: true,
  });
  const running = view.status === "queued" || view.status === "running";
  const pages = view.pages;
  const page = pages.find((item) => item.page === pageNumber) ?? pages[0];
  const sweeping = view.feed.some(
    (item) => item.kind === "sweep" && item.state === "start",
  );

  // Follow the Examiner to the page it is looking at.
  const lookPage = view.look?.page;
  useEffect(() => {
    if (lookPage) setPageNumber(lookPage);
  }, [lookPage]);

  const select = (findingId: string | null) => {
    setSelected(findingId);
    const finding = view.findings.find((item) => item.id === findingId);
    if (finding && finding.page > 0) setPageNumber(finding.page);
  };

  const [stopError, setStopError] = useState<string | null>(null);
  const stop = useWrite(async () => {
    if (!id) return;
    setStopError(null);
    const stopped = await stopExamination(id);
    if (!stopped.ok) setStopError(stopped.error);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onClose} data-testid="loupe-close">
          ← Another document
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {detail?.title ?? "Examination"}
        </h2>
        {detail ? <Tag tone="blue">{KIND_LABELS[detail.kind]}</Tag> : null}
        {view.driver ? <Tag>{DRIVERS[view.driver]}</Tag> : null}
        <Tag title="What the gateway says the model calls are worth">
          {money(view.costUsd)}
        </Tag>
        {running ? (
          <Button
            size="sm"
            variant="danger"
            pending={stop.pending}
            pendingLabel="Stopping…"
            onClick={() => stop.run()}
            data-testid="loupe-stop"
          >
            Stop
          </Button>
        ) : null}
      </div>
      {live.error ? <ErrorNote>{live.error}</ErrorNote> : null}
      {stopError ? <ErrorNote>{stopError}</ErrorNote> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="eyebrow mr-1 text-[0.65rem] text-ink-muted">
              Evidence layers
            </span>
            {(
              [
                ["boxes", "Findings"],
                ["layers", "Maps from code"],
                ["hypotheses", "Hypotheses"],
              ] as [keyof LayerToggles, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={toggles[key]}
                onClick={() =>
                  setToggles((now) => ({ ...now, [key]: !now[key] }))
                }
                data-testid={`loupe-toggle-${key}`}
                className={cx(
                  "outline-box rounded-sm px-2 py-1 font-mono text-[0.68rem] font-bold uppercase",
                  toggles[key]
                    ? "bg-ink text-paper"
                    : "bg-paper text-ink-muted",
                )}
              >
                {label}
              </button>
            ))}
            {pages.length > 1 ? (
              <span className="ml-auto flex items-center gap-1">
                {pages.map((item) => (
                  <button
                    key={item.page}
                    type="button"
                    aria-pressed={item.page === page?.page}
                    onClick={() => setPageNumber(item.page)}
                    className={cx(
                      "outline-box size-7 rounded-sm font-mono text-xs font-bold",
                      item.page === page?.page
                        ? "bg-federal-blue text-paper"
                        : "bg-paper",
                    )}
                  >
                    {item.page}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
          {page ? (
            <Stage
              examinationId={id}
              page={page}
              findings={view.findings}
              hypotheses={view.hypotheses}
              selected={selected}
              onSelect={select}
              toggles={toggles}
              look={running ? view.look : null}
              scanning={running && sweeping}
            />
          ) : (
            <div
              className="outline-box grid aspect-[3/4] place-items-center rounded-sm bg-marble"
              aria-busy="true"
            >
              <span className="flex items-center gap-2 text-sm text-ink-muted">
                <Spinner /> Opening the document in the sandbox…
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <VerdictCard
            view={view}
            running={running}
            examinationId={id}
            rulebookVersion={view.rulebookVersion ?? 0}
            currentRulebookVersion={currentRulebookVersion}
            onReevaluated={() => {
              live.reload();
              onChanged();
            }}
          />
          <Findings
            view={view}
            selected={selected}
            onSelect={select}
            examinationId={id}
            running={running}
            onRan={live.reload}
          />
          <Feed view={view} running={running} />
        </div>
      </div>
    </div>
  );
}

function VerdictCard({
  view,
  running,
  examinationId,
  rulebookVersion,
  currentRulebookVersion,
  onReevaluated,
}: {
  view: ExaminationView;
  running: boolean;
  examinationId: string | null;
  rulebookVersion: number;
  currentRulebookVersion: number;
  onReevaluated: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const again = useWrite(async () => {
    if (!examinationId) return;
    setError(null);
    setNote(null);
    const outcome = await reevaluateExamination(examinationId);
    if (!outcome.ok) return setError(outcome.error);
    const result = outcome.value;
    setNote(
      result.from === result.to
        ? `Still ${VERDICT_LABELS[result.to]} under Rulebook v${result.toVersion}.`
        : `${VERDICT_LABELS[result.from]} → ${VERDICT_LABELS[result.to]} under Rulebook v${result.toVersion}.`,
    );
    onReevaluated();
  });
  const verdict = view.verdict;
  const gate = view.gate;
  const score = view.score;
  return (
    <Panel
      eyebrow={
        running
          ? "Verdict so far, by the Rules"
          : `Verdict, by Rulebook v${rulebookVersion}`
      }
      title={
        view.status === "failed"
          ? "The Examination failed"
          : view.status === "stopped"
            ? "Stopped"
            : "Decided by Rules in code, not by the model"
      }
    >
      <div className="space-y-3">
        {view.error ? <ErrorNote>{view.error}</ErrorNote> : null}
        {verdict && view.status !== "failed" ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span
                key={verdict.verdict}
                data-testid="loupe-verdict"
                data-verdict={verdict.verdict}
                className={cx(
                  "lp-verdict outline-box rounded-sm px-3 py-1.5 font-mono text-lg font-bold tracking-[0.12em] uppercase shadow-hard-md",
                  VERDICT_TONE[verdict.verdict].box,
                  running && "opacity-70",
                )}
              >
                {VERDICT_LABELS[verdict.verdict]}
              </span>
              <span className="flex flex-wrap gap-1">
                <Tag tone="red">{verdict.decisive} decisive</Tag>
                <Tag tone="brass">{verdict.supporting} supporting</Tag>
                <Tag>{verdict.context} context</Tag>
              </span>
            </div>
            <ul className="space-y-1 text-sm">
              {verdict.reasons.slice(0, 5).map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span aria-hidden="true">·</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </>
        ) : running ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Waiting for the Sweep's first Measurements…
          </p>
        ) : view.status !== "failed" ? (
          <p className="text-sm text-ink-muted">
            No Verdict: the Examination ended before any Measurements were
            taken.
          </p>
        ) : null}
        {gate &&
        gate.pagesTotal > 0 &&
        view.driver !== "sweep" &&
        view.status !== "failed" ? (
          <p
            className="flex flex-wrap gap-1.5 text-xs"
            data-testid="loupe-gate"
            data-passed={gate.passed}
          >
            <Tag tone={gate.passed ? "green" : "neutral"}>
              Done gate {gate.passed ? "passed" : "open"}
            </Tag>
            <Tag>
              pages looked {gate.pagesLooked}/{gate.pagesTotal}
            </Tag>
            <Tag>{gate.findingsOpen} Findings to review</Tag>
            <Tag>{gate.hypothesesOpen} open Hypotheses</Tag>
            {view.stoppedBy ? (
              <Tag tone="brass">ended by the {view.stoppedBy} cap</Tag>
            ) : null}
          </p>
        ) : null}
        {score ? (
          <div
            className="rounded-sm border-2 border-ink/20 bg-marble p-2.5 text-sm"
            data-testid="loupe-score"
          >
            <p className="eyebrow mb-1 text-[0.65rem] text-ink-muted">
              Against what was really done to it
            </p>
            <p>
              This document was{" "}
              <strong>
                {score.truth === "tampered"
                  ? `altered in ${score.tampers} place${score.tampers === 1 ? "" : "s"}`
                  : "not altered"}
              </strong>
              . The Verdict is {score.correct ? "right" : "wrong"}
              {score.tampers
                ? `; ${score.caught} of ${score.tampers} alterations have a Finding on them`
                : ""}
              {score.falseFindings
                ? `; ${score.falseFindings} Finding${score.falseFindings === 1 ? "" : "s"} point at nothing that was changed`
                : ""}
              .
            </p>
            {score.perTamper.length ? (
              <ul className="mt-1 flex flex-wrap gap-1">
                {score.perTamper.map((item, index) => (
                  <li key={`${item.type}-${index}`}>
                    <span
                      className={cx(
                        "inline-block rounded-sm border px-1.5 py-px font-mono text-[0.68rem]",
                        item.caught
                          ? "border-ivy/30 bg-ivy/10 text-ivy"
                          : "border-seal-red/30 bg-seal-red/10 text-seal-red",
                      )}
                    >
                      {item.caught ? "caught" : "missed"}:{" "}
                      {TAMPER_TYPES[item.type]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {!running && view.status === "completed" ? (
          <div className="flex flex-wrap items-center gap-2 border-ink/15 border-t-2 pt-3">
            <Button
              size="sm"
              pending={again.pending}
              pendingLabel="Re-evaluating…"
              onClick={() => again.run()}
              data-testid="loupe-reevaluate"
            >
              Re-evaluate under Rulebook v{currentRulebookVersion}
            </Button>
            <span className="text-xs text-ink-muted">
              No model call: the stored Measurements are decided again by code.
            </span>
            {note ? (
              <output
                className="block basis-full text-sm font-medium"
                data-testid="loupe-reevaluate-note"
              >
                {note}
              </output>
            ) : null}
            {error ? <ErrorNote>{error}</ErrorNote> : null}
          </div>
        ) : null}
        <p className="text-xs text-ink-muted">
          Evidence for a human reviewer. Loupe measures and points; a person
          decides what it means.
        </p>
      </div>
    </Panel>
  );
}

function Meter({ finding }: { finding: Finding }) {
  // The bar runs to twice the larger of the two, so the mark never sits at an end.
  const span = Math.max(finding.value, finding.threshold) * 1.25 || 1;
  return (
    <div
      className="lp-meter"
      style={
        {
          "--lp-c":
            finding.weight === "decisive"
              ? "var(--color-seal-red)"
              : "var(--color-brass)",
        } as React.CSSProperties
      }
    >
      <div
        className="lp-meter-fill"
        style={{ width: `${Math.min(100, (finding.value / span) * 100)}%` }}
      />
      <div
        className="lp-meter-mark"
        style={{ left: `${(finding.threshold / span) * 100}%` }}
      />
    </div>
  );
}

const Findings = memo(function Findings({
  view,
  selected,
  onSelect,
  examinationId,
  running,
  onRan,
}: {
  view: ExaminationView;
  selected: string | null;
  onSelect: (findingId: string | null) => void;
  examinationId: string | null;
  running: boolean;
  onRan: () => void;
}) {
  const findings = view.findings;
  const [ranNote, setRanNote] = useState<string | null>(null);
  const rerun = useWrite(async (finding: Finding) => {
    if (!examinationId || !finding.check) return;
    setRanNote(null);
    const result = await runCheckAgain(examinationId, {
      check: finding.check,
      ...(finding.page > 0 ? { page: finding.page } : {}),
      box: finding.box,
    });
    setRanNote(
      result.ok ? (result.value.text.split("\n")[0] ?? "") : result.error,
    );
    onRan();
  });
  return (
    <Panel
      eyebrow={`${findings.length} Finding${findings.length === 1 ? "" : "s"}`}
      title="What code measured past a Rule"
      bodyClassName="p-0"
    >
      {findings.length === 0 ? (
        <p className="p-4 text-sm text-ink-muted">
          {view.measurements.length
            ? `${view.measurements.length} Measurements so far, none past its Rule's threshold.`
            : "Nothing measured yet."}
        </p>
      ) : (
        <ul className="divide-y-2 divide-ink/10" data-testid="loupe-findings">
          {findings.map((finding) => {
            const open = selected === finding.id;
            const code = view.code[finding.runId];
            const unit = METRICS[finding.metric].unit;
            return (
              <li key={finding.id} data-testid="loupe-finding">
                <button
                  type="button"
                  onClick={() => onSelect(open ? null : finding.id)}
                  aria-expanded={open}
                  className={cx(
                    "flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left",
                    open ? "bg-morning-haze" : "hover:bg-marble",
                  )}
                >
                  <Tag
                    tone={
                      finding.weight === "decisive"
                        ? "red"
                        : finding.weight === "supporting"
                          ? "brass"
                          : "neutral"
                    }
                  >
                    {finding.id} · {WEIGHT_LABELS[finding.weight]}
                  </Tag>
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    {METRICS[finding.metric].label}
                  </span>
                  <span className="font-mono text-xs">
                    {formatThreshold(finding.value)} {unit}
                    <span className="text-ink-muted">
                      {" "}
                      / {formatThreshold(finding.threshold)}
                    </span>
                  </span>
                </button>
                {open ? (
                  <div className="space-y-3 bg-morning-haze/50 px-4 pb-4 text-sm">
                    <Meter finding={finding} />
                    <p>{finding.detail}</p>
                    <p className="text-xs text-ink-muted">
                      Rule: {ruleSentence(finding.metric, finding.threshold)}{" "}
                      {METRICS[finding.metric].plain}
                    </p>
                    <p className="flex flex-wrap gap-1">
                      <Tag>
                        {finding.page > 0
                          ? `page ${finding.page}`
                          : "whole file"}
                      </Tag>
                      <Tag title="From how far past the threshold the measured value is. Code's, not the model's.">
                        confidence {Math.round(finding.confidence * 100)}%
                      </Tag>
                      {finding.foundBy.map((finder) => (
                        <Tag key={finder} tone="blue">
                          found by the{" "}
                          {finder === "sweep"
                            ? "Sweep"
                            : finder === "examiner"
                              ? "Examiner"
                              : "client"}
                        </Tag>
                      ))}
                      {finding.review ? (
                        <Tag
                          tone={
                            finding.review.stance === "agree"
                              ? "green"
                              : "brass"
                          }
                        >
                          Examiner {finding.review.stance}s
                        </Tag>
                      ) : null}
                    </p>
                    {finding.note ? (
                      <blockquote className="border-federal-blue border-l-4 pl-3 text-sm italic">
                        {finding.note}
                      </blockquote>
                    ) : null}
                    {Object.keys(finding.facts).length ? (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
                        {Object.entries(finding.facts)
                          .slice(0, 8)
                          .map(([key, value]) => (
                            <div key={key} className="contents">
                              <dt className="text-ink-muted">{key}</dt>
                              <dd className="truncate">{String(value)}</dd>
                            </div>
                          ))}
                      </dl>
                    ) : null}
                    <details className="rounded-sm border-2 border-ink bg-paper">
                      <summary className="cursor-pointer px-2.5 py-1.5 font-mono text-xs font-bold uppercase">
                        The code that measured it
                        {finding.check
                          ? ` · ${CHECKS[finding.check].label}`
                          : ""}
                      </summary>
                      <pre className="max-h-56 overflow-auto border-ink border-t-2 bg-ink p-2.5 font-mono text-[0.7rem] leading-relaxed text-paper">
                        {code?.code ??
                          (finding.check
                            ? `import loupe\nloupe.checks.${finding.check}(${finding.page > 0 ? `page=${finding.page}` : ""})`
                            : "(recorded when the Corpus was rendered)")}
                      </pre>
                      {code?.stdout ? (
                        <pre className="max-h-32 overflow-auto border-ink border-t-2 p-2.5 font-mono text-[0.68rem] text-ink-muted">
                          {code.stdout.slice(0, 1500)}
                        </pre>
                      ) : null}
                    </details>
                    {finding.check && !running ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          pending={rerun.pending}
                          pendingLabel="Running in the sandbox…"
                          onClick={() => rerun.run(finding)}
                          data-testid="loupe-rerun"
                        >
                          Run this Check again here
                        </Button>
                        {ranNote ? (
                          <output className="text-xs">{ranNote}</output>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
});

const FeedLine = memo(function FeedLine({
  item,
  view,
}: {
  item: FeedItem;
  view: ExaminationView;
}) {
  if (item.kind === "thought")
    return (
      <li className="lp-feed-item border-federal-blue border-l-4 py-0.5 pl-3 text-sm">
        {item.text}
      </li>
    );
  if (item.kind === "sweep")
    return (
      <li className="lp-feed-item flex flex-wrap items-center gap-1.5 text-xs">
        <Tag tone="ink">Sweep</Tag>
        {item.state === "start" ? (
          <span className="flex items-center gap-1.5">
            <Spinner /> running {item.checks} Checks, no model
          </span>
        ) : (
          <span>
            {item.measurements} Measurements from {item.checks} Checks in{" "}
            {seconds(item.ms)}
            {item.mode === "recorded" ? " (recorded with the Corpus)" : ""}
          </span>
        )}
      </li>
    );
  if (item.kind === "log" || item.kind === "reevaluated")
    return (
      <li className="lp-feed-item text-xs text-ink-muted">
        <Tag
          tone={
            item.kind === "log" && item.level === "error"
              ? "red"
              : item.kind === "reevaluated"
                ? "green"
                : "brass"
          }
        >
          {item.kind === "reevaluated" ? "re-evaluate" : item.level}
        </Tag>{" "}
        {item.text}
      </li>
    );
  const tool = view.tools[item.callId];
  if (!tool) return null;
  const code = view.code[item.callId];
  return (
    <li className="lp-feed-item text-xs" data-testid="loupe-tool">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-1.5">
          <Tag
            tone={
              tool.state === "error"
                ? "red"
                : tool.state === "start"
                  ? "blue"
                  : "neutral"
            }
          >
            {tool.state === "start" ? <Spinner className="size-2.5" /> : null}
            {tool.tool}
          </Tag>
          <span className="min-w-0 flex-1 truncate">{tool.summary}</span>
          {tool.ms ? (
            <span className="font-mono text-ink-muted">{seconds(tool.ms)}</span>
          ) : null}
        </summary>
        {code ? (
          <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-ink p-2 font-mono text-[0.68rem] text-paper">
            {code.code}
          </pre>
        ) : null}
        {tool.output ? (
          <pre className="mt-1 max-h-40 overflow-auto rounded-sm border-2 border-ink/20 bg-marble p-2 font-mono text-[0.68rem] whitespace-pre-wrap">
            {tool.output.slice(0, 1800)}
          </pre>
        ) : null}
      </details>
    </li>
  );
});

function Feed({ view, running }: { view: ExaminationView; running: boolean }) {
  const end = useRef<HTMLLIElement>(null);
  const count = view.feed.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a line is added.
  useEffect(() => {
    if (running)
      end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, running]);
  const hypotheses = useMemo(() => view.hypotheses, [view.hypotheses]);
  return (
    <Panel
      eyebrow={running ? "Live" : "The Trail"}
      title="The Examiner at work"
      actions={
        running ? (
          <span className="flex items-center gap-1.5 text-xs">
            <Spinner /> working
          </span>
        ) : null
      }
    >
      {hypotheses.length ? (
        <ul className="mb-3 space-y-1.5" data-testid="loupe-hypotheses">
          {hypotheses.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start gap-1.5 text-xs"
            >
              <Tag
                tone={
                  item.status === "supported"
                    ? "red"
                    : item.status === "refuted"
                      ? "green"
                      : "blue"
                }
              >
                {item.id} {item.status}
              </Tag>
              <span className="min-w-0 flex-1">
                {item.claim}
                {item.explanation ? (
                  <span className="text-ink-muted"> → {item.explanation}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ol
        className="max-h-[28rem] space-y-2 overflow-y-auto pr-1"
        aria-live="polite"
        data-testid="loupe-feed"
      >
        {view.feed.map((item) => (
          <FeedLine
            key={`${item.kind}-${item.seq}`}
            item={item}
            view={item.kind === "tool" ? view : EMPTY_FOR_STATIC}
          />
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
    </Panel>
  );
}

// Lines that do not read the view keep one stable prop, so only tool lines re-render.
const EMPTY_FOR_STATIC = { tools: {}, code: {} } as unknown as ExaminationView;
