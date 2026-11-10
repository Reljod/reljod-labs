"use client";

import { useState } from "react";
import {
  MODEL_IDS,
  MODELS,
  type ModelSettings,
  type ModelSettingsByPurpose,
  type Purpose,
  REASONING,
} from "../domain/model-config";
import { saveModelSettings } from "../server/actions";

const FIELD =
  "h-9 w-full min-w-0 rounded-sm border-2 border-ink/40 bg-paper px-2 text-sm focus:border-ink disabled:opacity-40";

/** A few words for a purpose's model: "GLM 5.3 Flash · low". */
export function modelSummary(settings: ModelSettings) {
  const model = MODELS[settings.model];
  return `${model.label}${model.reasoning && settings.reasoning ? ` · ${settings.reasoning}` : ""}`;
}

/** The model, reasoning, output cap and temperature one purpose calls with. Saves as it changes. */
export function ModelForm({
  purpose,
  settings,
  onSettings,
}: {
  purpose: Purpose;
  settings: ModelSettingsByPurpose;
  onSettings: (settings: ModelSettingsByPurpose) => void;
}) {
  const [saving, setSaving] = useState(false);
  const value = settings[purpose];
  const reasoning = MODELS[value.model].reasoning;

  async function update(patch: Partial<ModelSettings>) {
    const next = { ...value, ...patch };
    if (MODELS[next.model].reasoning) {
      next.temperature = null;
      next.reasoning ??= "low";
    } else {
      next.reasoning = null;
    }
    onSettings({ ...settings, [purpose]: next });
    setSaving(true);
    try {
      onSettings(await saveModelSettings(purpose, next));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="col-span-2 grid gap-1 text-xs">
        <span className="eyebrow flex justify-between text-ink-muted">
          <span>Model</span>
          {saving ? <span>Saving…</span> : null}
        </span>
        <select
          value={value.model}
          onChange={(event) =>
            update({ model: event.target.value as ModelSettings["model"] })
          }
          className={FIELD}
        >
          {MODEL_IDS.map((id) => (
            <option key={id} value={id}>
              {MODELS[id].label} · ${MODELS[id].input} in / ${MODELS[id].output}{" "}
              out per M
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        <span className="eyebrow text-ink-muted">Reasoning</span>
        <select
          value={value.reasoning ?? "none"}
          disabled={!reasoning}
          onChange={(event) =>
            update({
              reasoning: event.target.value as ModelSettings["reasoning"],
            })
          }
          className={FIELD}
        >
          {REASONING.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        <span className="eyebrow text-ink-muted">Max output tokens</span>
        <input
          type="number"
          min={256}
          max={32000}
          step={256}
          value={value.maxOutputTokens ?? ""}
          onChange={(event) =>
            update({
              maxOutputTokens: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
          className={FIELD}
        />
      </label>
      <label className="col-span-2 grid gap-1 text-xs">
        <span className="eyebrow flex justify-between text-ink-muted">
          <span>Temperature</span>
          <span className="normal-case tracking-normal">
            {reasoning
              ? "Fixed for reasoning models"
              : (value.temperature ?? "default")}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          disabled={reasoning}
          value={value.temperature ?? 0.7}
          onChange={(event) =>
            update({ temperature: Number(event.target.value) })
          }
          className="accent-federal-blue disabled:opacity-40"
        />
      </label>
    </div>
  );
}
