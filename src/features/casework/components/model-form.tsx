"use client";

import { useState } from "react";
import {
  DEFAULT_SETTINGS,
  MODEL_IDS,
  MODELS,
  type ModelSettings,
  type ModelSettingsByPurpose,
  type Purpose,
  REASONING,
  type Reasoning,
} from "../domain/model-config";
import { saveModelSettings } from "../server/actions";

/** A few words for a purpose's model: "GLM 5.3 Flash · low". */
export function modelSummary(settings: ModelSettings) {
  const model = MODELS[settings.model];
  return `${model.label}${model.reasoning && settings.reasoning ? ` · ${settings.reasoning}` : ""}`;
}

const REASONING_LABEL: Record<Reasoning, string> = {
  none: "Off",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
};

const OUTPUT_PRESETS = [1_000, 2_000, 4_000, 8_000, 16_000];

function Field({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5 border-ink/10 border-t px-3 py-2.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] font-bold tracking-[0.1em] text-ink uppercase">
          {label}
        </span>
        {aside ? (
          <span className="min-w-0 truncate text-right font-mono text-[10px] text-ink-muted">
            {aside}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function same(a: ModelSettings, b: ModelSettings) {
  return (
    a.model === b.model &&
    a.reasoning === b.reasoning &&
    a.temperature === b.temperature &&
    a.maxOutputTokens === b.maxOutputTokens
  );
}

/**
 * What one purpose calls its model with: the model, how hard it thinks, how
 * much it may write and how much it varies. Saves as it changes.
 */
export function ModelForm({
  purpose,
  settings,
  onSettings,
}: {
  purpose: Purpose;
  settings: ModelSettingsByPurpose;
  onSettings: (settings: ModelSettingsByPurpose) => void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );
  const value = settings[purpose];
  const model = MODELS[value.model];
  const changed = !same(value, DEFAULT_SETTINGS[purpose]);

  async function update(patch: Partial<ModelSettings>) {
    const next = { ...value, ...patch };
    if (MODELS[next.model].reasoning) {
      next.temperature = null;
      next.reasoning ??= "low";
    } else {
      next.reasoning = null;
    }
    onSettings({ ...settings, [purpose]: next });
    setState("saving");
    try {
      onSettings(await saveModelSettings(purpose, next));
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-sm border-2 border-ink bg-paper">
      <Field
        label="Model"
        aside={`$${model.input.toFixed(2)} in · $${model.output.toFixed(2)} out per 1M tokens`}
      >
        <select
          value={value.model}
          onChange={(event) =>
            update({ model: event.target.value as ModelSettings["model"] })
          }
          aria-label="Model"
          className="h-9 w-full min-w-0 rounded-sm border-2 border-ink/30 bg-marble/50 px-2 text-sm font-semibold hover:border-ink focus:border-ink"
        >
          {MODEL_IDS.map((id) => (
            <option key={id} value={id}>
              {MODELS[id].label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Reasoning"
        aside={
          model.reasoning ? "How hard it thinks first" : "Not on this model"
        }
      >
        <div
          className={`grid grid-cols-5 overflow-hidden rounded-sm border-2 ${model.reasoning ? "border-ink/30" : "border-ink/15 opacity-45"}`}
        >
          {REASONING.map((level) => {
            const on = model.reasoning && (value.reasoning ?? "none") === level;
            return (
              <button
                key={level}
                type="button"
                disabled={!model.reasoning}
                aria-pressed={on}
                title={level}
                onClick={() => update({ reasoning: level })}
                className={`border-ink/15 border-r py-1.5 font-mono text-[11px] font-bold transition-colors last:border-r-0 ${on ? "bg-ink text-paper" : "bg-paper text-ink-muted enabled:hover:bg-morning-haze/60"}`}
              >
                {REASONING_LABEL[level]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Max output" aside="Tokens it may write">
        <div className="flex min-w-0 items-center gap-1.5">
          <input
            type="number"
            min={256}
            max={32000}
            step={256}
            aria-label="Max output tokens"
            value={value.maxOutputTokens ?? ""}
            onChange={(event) =>
              update({
                maxOutputTokens: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
            className="h-8 w-20 shrink-0 rounded-sm border-2 border-ink/30 bg-marble/50 px-2 font-mono text-xs hover:border-ink focus:border-ink"
          />
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {OUTPUT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={value.maxOutputTokens === preset}
                onClick={() => update({ maxOutputTokens: preset })}
                className={`rounded-sm border px-1.5 py-1 font-mono text-[10px] font-bold transition-colors ${value.maxOutputTokens === preset ? "border-ink bg-ink text-paper" : "border-ink/25 text-ink-muted hover:border-ink hover:text-ink"}`}
              >
                {preset / 1000}k
              </button>
            ))}
          </div>
        </div>
      </Field>

      <Field
        label="Temperature"
        aside={
          model.reasoning
            ? "Set by the model"
            : (value.temperature ?? 0.7).toFixed(2)
        }
      >
        {model.reasoning ? (
          <p className="text-xs text-ink-muted">
            Reasoning models pick their own. Choose a model without reasoning to
            set it.
          </p>
        ) : (
          <div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              aria-label="Temperature"
              value={value.temperature ?? 0.7}
              onChange={(event) =>
                update({ temperature: Number(event.target.value) })
              }
              className="block w-full accent-federal-blue"
            />
            <div className="flex justify-between font-mono text-[9px] text-stone uppercase">
              <span>Exact</span>
              <span>Varied</span>
            </div>
          </div>
        )}
      </Field>

      <div className="flex items-center justify-between gap-2 border-ink/10 border-t bg-marble/60 px-3 py-1.5 font-mono text-[10px]">
        <span
          className={
            state === "failed" ? "font-bold text-seal-red" : "text-ink-muted"
          }
          aria-live="polite"
        >
          {state === "saving"
            ? "Saving…"
            : state === "failed"
              ? "Could not save"
              : state === "saved"
                ? "✓ Saved for this desk"
                : changed
                  ? "Changed from the default"
                  : "Default settings"}
        </span>
        {changed ? (
          <button
            type="button"
            onClick={() => update(DEFAULT_SETTINGS[purpose])}
            className="font-bold text-federal-blue underline"
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}
