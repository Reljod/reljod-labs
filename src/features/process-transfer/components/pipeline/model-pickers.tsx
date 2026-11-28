"use client";

import { useEffect, useRef, useState } from "react";
import {
  MODELS,
  type ModelChoice,
  type ModelId,
  modelsFor,
  PURPOSE_IDS,
  PURPOSES,
} from "../../domain/models";
import { saveModels } from "../api";
import {
  fieldClass,
  InlineError,
  InlineNote,
  linkButtonClass,
  smallButtonClass,
} from "../ui";

function same(a: ModelChoice, b: ModelChoice): boolean {
  return PURPOSE_IDS.every((purpose) => a[purpose] === b[purpose]);
}

/**
 * The three models the pipeline calls: Watch, Write and Review. Only a model
 * that takes video can Watch. Saved together; the next Run uses them.
 */
export function ModelPickers({
  models,
  onSaved,
}: {
  models: ModelChoice;
  onSaved: (models: ModelChoice) => void;
}) {
  const [draft, setDraft] = useState<ModelChoice>(models);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const dirty = !same(draft, models);
  const stored = PURPOSE_IDS.map((purpose) => models[purpose]).join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the stored choice by content
  useEffect(() => {
    setDraft(models);
  }, [stored]);

  const save = async () => {
    if (busy.current || !dirty) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const result = await saveModels(draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.value);
      setNote("Saved. Your next Run uses these models.");
    } catch {
      setError("That did not reach the server. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col divide-y divide-ink/10">
        {PURPOSE_IDS.map((purpose) => {
          const id = `ho-model-${purpose}`;
          const price = MODELS[draft[purpose]];
          return (
            <div
              key={purpose}
              className="grid min-w-0 gap-x-4 gap-y-1.5 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_14rem]"
            >
              <div className="min-w-0">
                <label htmlFor={id} className="eyebrow font-bold">
                  {PURPOSES[purpose].label}
                </label>
                <p id={`${id}-hint`} className="text-sm text-ink-muted">
                  {PURPOSES[purpose].hint}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <select
                  id={id}
                  value={draft[purpose]}
                  disabled={pending}
                  aria-describedby={`${id}-hint ${id}-price`}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [purpose]: event.target.value as ModelId,
                    }))
                  }
                  className={fieldClass}
                >
                  {modelsFor(purpose).map((model) => (
                    <option key={model} value={model}>
                      {MODELS[model].label}
                    </option>
                  ))}
                </select>
                <p
                  id={`${id}-price`}
                  className="font-mono text-[11px] text-ink-muted"
                >
                  {price
                    ? `$${price.input} in / $${price.output} out per M tokens`
                    : null}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          aria-busy={pending}
          className={smallButtonClass}
        >
          {pending ? "Saving…" : "Save models"}
        </button>
        {dirty && !pending ? (
          <button
            type="button"
            onClick={() => setDraft(models)}
            className={`${linkButtonClass} text-sm`}
          >
            Undo changes
          </button>
        ) : null}
      </div>
      <InlineNote>{note}</InlineNote>
      <InlineError>{error}</InlineError>
    </div>
  );
}
