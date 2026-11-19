"use client";

import { useId, useRef, useState } from "react";
import {
  DEFAULT_MODEL,
  type ManifestSummary,
  MODEL_IDS,
  MODELS,
  type ModelId,
  type RunSummary,
  type TaskCard,
  type TaskRef,
} from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { startRun } from "../server/actions";
import { bytes, modelPrice, usd } from "./format";
import { loadHandKit } from "./hand-kit";
import {
  Button,
  cx,
  ErrorNote,
  fieldClass,
  friendly,
  Spinner,
  Tag,
  useWrite,
} from "./ui";
import { type ManifestStage, uploadManifest } from "./upload";

const OWN = "own";

const CARD =
  "outline-box press flex min-h-44 flex-col gap-2 rounded-sm p-3 text-left";

function SampleCard({
  task,
  number,
  picked,
  onPick,
}: {
  task: TaskCard;
  number: number;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <div className={cx("relative flex flex-col", picked && "z-[1]")}>
      <button
        type="button"
        aria-pressed={picked}
        onClick={onPick}
        className={cx(
          CARD,
          "flex-1 pb-9",
          picked ? "bg-morning-haze" : "bg-paper",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="eyebrow text-[0.62rem] text-ink-muted">
            Sample Task {number}
          </span>
          <span
            aria-hidden="true"
            className={cx(
              "grid size-4 place-items-center border-2 border-ink font-mono text-[0.6rem] font-bold",
              picked ? "bg-ink text-paper" : "bg-paper",
            )}
          >
            {picked ? "✓" : ""}
          </span>
        </span>
        <span className="text-base leading-snug font-semibold">
          {task.title}
        </span>
        <span className="text-sm text-ink-muted">{task.summary}</span>
        <span className="mt-auto flex flex-wrap gap-1 pt-1">
          {task.needsApproval ? <Tag tone="red">Needs a person</Tag> : null}
          {task.traps.map((trap) => (
            <Tag key={trap} tone="brass">
              {trap}
            </Tag>
          ))}
        </span>
      </button>
      {/* Beside the button, not inside it: a link in a button is not reachable. */}
      <p className="pointer-events-none absolute inset-x-3 bottom-2 truncate font-mono text-[0.68rem] text-ink-muted">
        {task.manifest ? (
          <>
            Manifest:{" "}
            <a
              href={task.manifest.href}
              target="_blank"
              rel="noreferrer"
              className="pointer-events-auto font-bold text-federal-blue underline"
            >
              {task.manifest.name}
            </a>{" "}
            ({task.manifest.rows} rows)
          </>
        ) : (
          "No Manifest"
        )}
      </p>
    </div>
  );
}

/** The Manifest of an own Task: attach a CSV or PDF, see what the server read. */
function ManifestAttach({
  manifest,
  onChange,
  disabled,
}: {
  manifest: ManifestSummary | null;
  onChange: (manifest: ManifestSummary | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<ManifestStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const write = useWrite(async (file: File) => {
    setError(null);
    try {
      onChange(await uploadManifest(file, setStage));
    } catch (caught) {
      setError(friendly(caught, "The Manifest did not attach."));
    } finally {
      setStage(null);
    }
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={disabled}
          pending={write.pending}
          pendingLabel={
            stage === "reading" ? "Reading the rows…" : "Uploading…"
          }
          onClick={() => input.current?.click()}
        >
          {manifest ? "Attach another" : "Attach a Manifest"}
        </Button>
        {manifest ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={write.pending || disabled}
            onClick={() => onChange(null)}
          >
            Remove
          </Button>
        ) : null}
        <label htmlFor={id} className="text-xs text-ink-muted">
          Optional. CSV or PDF, up to {bytes(LIMITS.manifestBytes)} and{" "}
          {LIMITS.manifestRows} rows.
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          disabled={disabled || write.pending}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void write.run(file);
          }}
        />
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {manifest ? (
        <output className="block rounded-sm border-2 border-ink/15 bg-marble px-3 py-2 text-xs">
          <p>
            <span className="font-mono font-bold">{manifest.name}</span>:{" "}
            {manifest.rows} rows
            {manifest.vessel ? `, vessel ${manifest.vessel}` : ""}
            {manifest.voyage ? `, voyage ${manifest.voyage}` : ""}.
          </p>
          {manifest.problems.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-seal-red">
              {manifest.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">
              Read without problems. After the Run, code compares the Books with
              these rows, field for field.
            </p>
          )}
        </output>
      ) : null}
    </div>
  );
}

/**
 * Pick a Task, a model and who drives. "Let the Operator do it" starts a
 * Run; "Take the keyboard" hands HARBOURMASTER to the visitor (sample Tasks
 * only). Both say what happened where they were clicked.
 */
export function TaskPicker({
  tasks,
  inFlight,
  handTaskId,
  onOpenRun,
  onStarted,
  onHand,
}: {
  tasks: TaskCard[];
  /** A Run of the Owner's that is still going: one at a time. */
  inFlight: RunSummary | null;
  /** The Task being keyed by hand right now, if any. */
  handTaskId: string | null;
  onOpenRun: (run: RunSummary) => void;
  onStarted: (runId: string) => void;
  onHand: (taskId: string) => void;
}) {
  const id = useId();
  const [picked, setPicked] = useState<string>(tasks[0]?.id ?? OWN);
  const [brief, setBrief] = useState("");
  const [manifest, setManifest] = useState<ManifestSummary | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [error, setError] = useState<string | null>(null);
  const own = picked === OWN;
  const words = brief.trim();

  const start = useWrite(async () => {
    setError(null);
    const task: TaskRef = own
      ? { kind: "own", brief: words }
      : { kind: "sample", taskId: picked };
    try {
      const result = await startRun({
        task,
        manifestId: own ? (manifest?.id ?? null) : null,
        model,
      });
      if ("error" in result) setError(result.error);
      else onStarted(result.runId);
    } catch (caught) {
      setError(friendly(caught, "The Run could not start."));
    }
  });

  const blocked = own && words.length === 0;
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2
          id={`${id}-title`}
          className="font-mono text-lg font-bold uppercase"
        >
          1. Pick a Task
        </h2>
        <p className="font-mono text-[0.7rem] text-ink-muted">
          Caps: {LIMITS.runsPerVisitorPerHour} Runs an hour ·{" "}
          {usd(LIMITS.usdPerRun)} a Run · {LIMITS.actionsPerRun} Actions a Run
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tasks.map((task, index) => (
          <SampleCard
            key={task.id}
            task={task}
            number={index + 1}
            picked={picked === task.id}
            onPick={() => {
              setPicked(task.id);
              setError(null);
            }}
          />
        ))}
        <div
          className={cx(
            "outline-box flex min-h-44 flex-col gap-2 rounded-sm p-3 shadow-hard-md",
            own ? "bg-morning-haze" : "bg-paper",
          )}
        >
          <label
            htmlFor={`${id}-brief`}
            className="flex items-center justify-between gap-2"
          >
            <span className="eyebrow text-[0.62rem] text-ink-muted">
              Your own Task
            </span>
            <span className="font-mono text-[0.62rem] text-ink-muted tabular-nums">
              {brief.length}/{LIMITS.taskChars}
            </span>
          </label>
          <textarea
            id={`${id}-brief`}
            value={brief}
            maxLength={LIMITS.taskChars}
            rows={4}
            placeholder="Say what you want done in HARBOURMASTER, in plain words. For example: place a customs hold, reason 23, on container MRDU4821130."
            onFocus={() => setPicked(OWN)}
            onChange={(event) => {
              setBrief(event.target.value);
              setPicked(OWN);
              setError(null);
            }}
            className={cx(fieldClass, "h-auto flex-1 resize-y py-1.5")}
          />
          <ManifestAttach
            manifest={manifest}
            disabled={start.pending}
            onChange={(next) => {
              setManifest(next);
              setPicked(OWN);
            }}
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-model`} className="eyebrow text-[0.65rem]">
            The Operator's model
          </label>
          <select
            id={`${id}-model`}
            value={model}
            onChange={(event) => setModel(event.target.value as ModelId)}
            className={cx(fieldClass, "max-w-sm")}
          >
            {MODEL_IDS.map((item) => (
              <option key={item} value={item}>
                {MODELS[item].label}
              </option>
            ))}
          </select>
          <p className="text-sm text-ink-muted">
            {MODELS[model].note}{" "}
            <span className="font-mono text-xs">{modelPrice(model)}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={blocked || inFlight !== null}
              pending={start.pending}
              pendingLabel="Starting the Run…"
              onClick={() => void start.run()}
            >
              Let the Operator do it
            </Button>
            <Button
              disabled={own || start.pending || handTaskId === picked}
              onPointerEnter={() => void loadHandKit().catch(() => undefined)}
              onFocus={() => void loadHandKit().catch(() => undefined)}
              onClick={() => onHand(picked)}
            >
              {handTaskId === picked
                ? "You have the keyboard"
                : "Take the keyboard"}
            </Button>
          </div>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {inFlight ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Spinner />
              One Run at a time, and "{inFlight.title}" is still going.
              <Button size="sm" onClick={() => onOpenRun(inFlight)}>
                Open it
              </Button>
            </p>
          ) : blocked ? (
            <p className="text-sm text-ink-muted">
              Write your Task first. Taking the keyboard is for the sample
              Tasks, which have Books to check against.
            </p>
          ) : own ? (
            <p className="text-sm text-ink-muted">
              {manifest
                ? "Code will compare the Books with your Manifest."
                : "Without a Manifest there is nothing to compare the outcome with, so the Verdict can only be unverified."}{" "}
              Taking the keyboard is for the sample Tasks.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              The Operator sees only pictures of the Screen and answers with
              keys and clicks. Or key the same Task yourself and compare.
            </p>
          )}
        </div>
      </div>

      <p className="border-ink/20 border-l-4 pl-3 text-sm text-ink-muted">
        <span className="font-semibold text-ink">Where this is in a bank.</span>{" "}
        Core-banking green screens, payment repair queues, anything a clerk keys
        all day because the system has no API.
      </p>
    </section>
  );
}
