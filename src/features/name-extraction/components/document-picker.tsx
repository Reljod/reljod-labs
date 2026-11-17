"use client";

import { useId, useRef, useState } from "react";
import {
  type CorpusCard,
  DEFAULT_MODELS,
  type DocumentSource,
  MODEL_IDS,
  MODELS,
  type ModelChoice,
  PURPOSES,
  type Purpose,
  SPLITS,
  type Split,
} from "../domain/contract";
import { Button, cx, ErrorNote, fieldClass, Panel, Tag, useWrite } from "./ui";
import { MAX_PAGES, type UploadProgress, uploadPdf } from "./upload";

const SIZES = [
  { id: "all", label: "Any size", test: () => true },
  { id: "short", label: "≤ 50 pages", test: (pages: number) => pages <= 50 },
  {
    id: "medium",
    label: "51–200",
    test: (pages: number) => pages > 50 && pages <= 200,
  },
  { id: "long", label: "> 200", test: (pages: number) => pages > 200 },
] as const;
type SizeId = (typeof SIZES)[number]["id"];

const SPLIT_TONE: Record<Split, "neutral" | "blue" | "brass"> = {
  train: "neutral",
  validation: "blue",
  test: "brass",
};

type Choice =
  | { kind: "corpus"; card: CorpusCard }
  | { kind: "upload"; file: File };

function progressText(progress: UploadProgress | null) {
  if (!progress) return null;
  if (progress.stage === "reading")
    return `Reading page ${progress.done + 1} of ${progress.total}…`;
  if (progress.stage === "uploading") return "Uploading the text…";
  return "Uploaded.";
}

/**
 * Pick a Corpus Document (filter by split and size) or drop a PDF, choose
 * the models, and start a Run. Start fires once; its error shows beside it.
 */
export function DocumentPicker({
  corpus,
  corpusError,
  busy,
  onStart,
}: {
  corpus: CorpusCard[] | null;
  corpusError: string | null;
  /** A Run of this person's is in flight. */
  busy: boolean;
  onStart: (input: {
    source: DocumentSource;
    models: ModelChoice;
  }) => Promise<string | null>;
}) {
  const [split, setSplit] = useState<Split | "all">("all");
  const [size, setSize] = useState<SizeId>("all");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [models, setModels] = useState<ModelChoice>(DEFAULT_MODELS);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  const sizeTest = SIZES.find((item) => item.id === size)?.test ?? (() => true);
  const shown = (corpus ?? []).filter(
    (card) => (split === "all" || card.split === split) && sizeTest(card.pages),
  );

  const take = (file: File | undefined) => {
    setError(null);
    setProgress(null);
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("Only PDF files.");
      return;
    }
    setChoice({ kind: "upload", file });
  };

  const start = useWrite(async () => {
    if (!choice) return;
    setError(null);
    try {
      let source: DocumentSource;
      if (choice.kind === "corpus") {
        source = { kind: "corpus", corpusId: choice.card.id };
      } else {
        const uploadId = await uploadPdf(choice.file, setProgress);
        source = { kind: "upload", uploadId };
      }
      const problem = await onStart({ source, models });
      if (problem) setError(problem);
      else setProgress(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start.");
    }
  });

  return (
    <Panel
      eyebrow="1 · Document"
      title="Pick a document, or drop a PDF"
      bodyClassName="flex flex-col gap-4 p-4"
    >
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Filter the corpus</legend>
        {(["all", ...SPLITS] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={split === item}
            onClick={() => setSplit(item)}
            className={cx(
              "h-7 rounded-sm border px-2.5 font-mono text-xs",
              split === item
                ? "border-ink bg-ink text-paper"
                : "border-ink/25 bg-paper hover:bg-marble",
            )}
          >
            {item === "all" ? "All splits" : item}
          </button>
        ))}
        <select
          aria-label="Size"
          value={size}
          onChange={(event) => setSize(event.target.value as SizeId)}
          className={cx(fieldClass, "h-7 text-xs")}
        >
          {SIZES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-muted">
          Synthetic, fictional Republic of Meridia. Tune on train and
          validation; test is held out.
        </span>
      </fieldset>

      {corpusError ? <ErrorNote>{corpusError}</ErrorNote> : null}
      {corpus === null && !corpusError ? (
        <p className="text-sm text-ink-muted">Loading the corpus…</p>
      ) : null}

      <ul className="sv-scroll grid max-h-[26rem] gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((card) => {
          const selected =
            choice?.kind === "corpus" && choice.card.id === card.id;
          return (
            <li key={card.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setError(null);
                  setChoice({ kind: "corpus", card });
                }}
                className={cx(
                  "flex h-full w-full flex-col gap-1.5 rounded-sm border p-3 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
                  selected
                    ? "border-federal-blue bg-morning-haze"
                    : "border-ink/15 bg-paper hover:border-ink/40",
                )}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <Tag tone={SPLIT_TONE[card.split]}>{card.split}</Tag>
                  <span className="eyebrow text-[0.65rem] text-ink-muted">
                    {card.genre}
                  </span>
                </span>
                <span className="text-sm font-semibold">{card.title}</span>
                <span className="line-clamp-2 text-xs text-ink-muted">
                  {card.description}
                </span>
                <span className="mt-auto flex gap-3 font-mono text-[0.7rem] text-ink-muted">
                  <span>{card.pages} pages</span>
                  <span>{card.expectedNames} names expected</span>
                </span>
              </button>
            </li>
          );
        })}
        {corpus && shown.length === 0 ? (
          <li className="text-sm text-ink-muted">No document matches.</li>
        ) : null}
      </ul>

      <label
        htmlFor={`${id}-file`}
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files[0]);
        }}
        className={cx(
          "sv-drop flex cursor-pointer flex-col items-center gap-1 rounded-sm border border-dashed px-4 py-5 text-center text-sm",
          choice?.kind === "upload"
            ? "border-federal-blue bg-morning-haze"
            : "border-ink/30 bg-marble/50 hover:bg-marble",
        )}
      >
        {choice?.kind === "upload" ? (
          <span className="font-semibold">{choice.file.name}</span>
        ) : (
          <span className="font-semibold">Drop a PDF here, or choose one</span>
        )}
        <span className="text-xs text-ink-muted">
          Up to {MAX_PAGES} pages with a text layer. The text is read in your
          browser; only the text is uploaded.
        </span>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => {
            take(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="eyebrow mb-2 text-[0.65rem] text-ink-muted">
          2 · Models
        </legend>
        {(Object.keys(PURPOSES) as Purpose[]).map((purpose) => (
          <label key={purpose} className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="font-semibold">
              {PURPOSES[purpose].label}{" "}
              <span className="font-normal text-ink-muted">
                {PURPOSES[purpose].hint}
              </span>
            </span>
            <select
              value={models[purpose]}
              onChange={(event) =>
                setModels((current) => ({
                  ...current,
                  [purpose]: event.target.value,
                }))
              }
              className={fieldClass}
            >
              {MODEL_IDS.map((model) => (
                <option key={model} value={model}>
                  {MODELS[model].label} · ${MODELS[model].input} / $
                  {MODELS[model].output} per M tokens
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          pending={start.pending}
          pendingLabel={choice?.kind === "upload" ? "Uploading…" : "Starting…"}
          disabled={!choice || busy}
          onClick={() => void start.run()}
        >
          Extract names
        </Button>
        <span className="text-sm text-ink-muted" aria-live="polite">
          {progressText(progress) ??
            (busy
              ? "A run is in flight. Stop it or wait for it to finish."
              : choice
                ? choice.kind === "corpus"
                  ? `${choice.card.title}, ${choice.card.pages} pages`
                  : choice.file.name
                : "Pick a document first.")}
        </span>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
    </Panel>
  );
}
