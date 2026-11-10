"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  MODEL_IDS,
  MODELS,
  type ModelSettings,
  type ModelSettingsByPurpose,
  PURPOSE_IDS,
  PURPOSES,
  type Purpose,
  REASONING,
} from "../domain/model-config";
import { resetModelSettings, saveModelSettings } from "../server/actions";
import type { SpendView } from "../view";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: ModelSettingsByPurpose;
  onSettings: (settings: ModelSettingsByPurpose) => void;
  spend: SpendView;
};

/** Model settings per purpose, and where the money went. */
export function SettingsDrawer({
  open,
  onClose,
  settings,
  onSettings,
  spend,
}: Props) {
  const [tab, setTab] = useState<"models" | "spend">("models");
  const [saving, setSaving] = useState<Purpose | null>(null);

  async function update(purpose: Purpose, patch: Partial<ModelSettings>) {
    const next = { ...settings[purpose], ...patch };
    if (MODELS[next.model].reasoning) next.temperature = null;
    else next.reasoning = null;
    onSettings({ ...settings, [purpose]: next });
    setSaving(purpose);
    try {
      onSettings(await saveModelSettings(purpose, next));
    } finally {
      setSaving(null);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            role="dialog"
            aria-label="Models and spend"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-md flex-col border-ink border-l-2 bg-marble shadow-hard-lg"
          >
            <header className="flex items-center gap-2 border-ink border-b-2 bg-paper px-4 py-3">
              {(["models", "spend"] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setTab(name)}
                  className={`rounded-sm border-2 border-ink px-3 py-1 font-mono text-xs font-bold tracking-[0.08em] uppercase ${tab === name ? "bg-ink text-paper" : "bg-paper"}`}
                >
                  {name === "models"
                    ? "Models"
                    : `Spend $${spend.totalUsd.toFixed(4)}`}
                </button>
              ))}
              <button
                type="button"
                onClick={onClose}
                className="ml-auto px-2 font-mono text-lg font-bold"
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className="cw-scroll min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "models" ? (
                <div className="grid gap-3">
                  <p className="text-sm text-ink-muted">
                    Each purpose has its own model. Changes apply to this desk's
                    next calls; jobs already running keep theirs.
                  </p>
                  {PURPOSE_IDS.map((purpose) => {
                    const value = settings[purpose];
                    const reasoning = MODELS[value.model].reasoning;
                    return (
                      <section
                        key={purpose}
                        className="outline-box rounded-sm bg-paper p-3"
                      >
                        <div className="flex items-baseline justify-between">
                          <h3 className="font-mono text-sm font-bold tracking-[0.06em] uppercase">
                            {PURPOSES[purpose].label}
                          </h3>
                          <span className="font-mono text-[10px] text-ink-muted">
                            {saving === purpose
                              ? "Saving…"
                              : PURPOSES[purpose].hint}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="col-span-2 grid gap-1 text-xs">
                            <span className="eyebrow text-ink-muted">
                              Model
                            </span>
                            <select
                              value={value.model}
                              onChange={(event) =>
                                update(purpose, {
                                  model: event.target
                                    .value as ModelSettings["model"],
                                })
                              }
                              className="h-9 rounded-sm border-2 border-ink bg-marble px-2 text-sm"
                            >
                              {MODEL_IDS.map((id) => (
                                <option key={id} value={id}>
                                  {MODELS[id].label} · ${MODELS[id].input}/$
                                  {MODELS[id].output} per M
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs">
                            <span className="eyebrow text-ink-muted">
                              Reasoning
                            </span>
                            <select
                              value={value.reasoning ?? "none"}
                              disabled={!reasoning}
                              onChange={(event) =>
                                update(purpose, {
                                  reasoning: event.target
                                    .value as ModelSettings["reasoning"],
                                })
                              }
                              className="h-9 rounded-sm border-2 border-ink bg-marble px-2 text-sm disabled:opacity-40"
                            >
                              {REASONING.map((level) => (
                                <option key={level} value={level}>
                                  {level}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs">
                            <span className="eyebrow text-ink-muted">
                              Max output
                            </span>
                            <input
                              type="number"
                              min={256}
                              max={32000}
                              step={256}
                              value={value.maxOutputTokens ?? ""}
                              onChange={(event) =>
                                update(purpose, {
                                  maxOutputTokens: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                              className="h-9 rounded-sm border-2 border-ink bg-marble px-2 text-sm"
                            />
                          </label>
                          <label className="col-span-2 grid gap-1 text-xs">
                            <span className="eyebrow flex justify-between text-ink-muted">
                              <span>Temperature</span>
                              <span>
                                {reasoning
                                  ? "Reasoning models fix it"
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
                                update(purpose, {
                                  temperature: Number(event.target.value),
                                })
                              }
                              className="accent-federal-blue disabled:opacity-40"
                            />
                          </label>
                        </div>
                      </section>
                    );
                  })}
                  <button
                    type="button"
                    onClick={async () => onSettings(await resetModelSettings())}
                    className="justify-self-start font-mono text-xs font-bold text-federal-blue uppercase underline"
                  >
                    Reset to GPT-6.1 Terra everywhere
                  </button>
                </div>
              ) : (
                <div className="grid gap-3">
                  <p className="font-mono text-4xl font-bold">
                    ${spend.totalUsd.toFixed(4)}
                  </p>
                  <p className="text-sm text-ink-muted">
                    Every model call this desk made, priced by Vercel AI
                    Gateway.
                  </p>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-ink border-b-2 font-mono tracking-[0.06em] uppercase">
                        <th className="py-1.5">Purpose</th>
                        <th>Model</th>
                        <th className="text-right">Calls</th>
                        <th className="text-right">Tokens</th>
                        <th className="text-right">USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spend.rows
                        .sort((a, b) => b.costUsd - a.costUsd)
                        .map((row) => (
                          <tr
                            key={`${row.purpose}-${row.model}`}
                            className="border-ink/15 border-b"
                          >
                            <td className="py-1.5 font-medium">
                              {PURPOSES[row.purpose]?.label ?? row.purpose}
                            </td>
                            <td className="text-ink-muted">
                              {MODELS[row.model as keyof typeof MODELS]
                                ?.label ?? row.model}
                            </td>
                            <td className="text-right font-mono">
                              {row.calls}
                            </td>
                            <td className="text-right font-mono">
                              {(
                                (row.inputTokens + row.outputTokens) /
                                1000
                              ).toFixed(1)}
                              k
                            </td>
                            <td className="text-right font-mono">
                              {row.costUsd.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {spend.rows.length === 0 ? (
                    <p className="text-sm text-ink-muted">Nothing spent yet.</p>
                  ) : null}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
