"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  MODELS,
  type ModelSettingsByPurpose,
  PURPOSE_IDS,
  PURPOSES,
} from "../domain/model-config";
import { resetModelSettings } from "../server/actions";
import type { SpendView } from "../view";
import { ModelForm } from "./model-form";

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
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-ink/30"
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
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 right-0 bottom-0 z-[61] flex w-full max-w-md flex-col border-ink border-l-2 bg-marble shadow-hard-lg"
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
                  {PURPOSE_IDS.map((purpose) => (
                    <section
                      key={purpose}
                      className="outline-box rounded-sm bg-paper p-3"
                    >
                      <h3 className="font-mono text-sm font-bold tracking-[0.06em] uppercase">
                        {PURPOSES[purpose].label}
                      </h3>
                      <p className="mb-2 text-xs text-ink-muted">
                        {PURPOSES[purpose].hint}
                      </p>
                      <ModelForm
                        purpose={purpose}
                        settings={settings}
                        onSettings={onSettings}
                      />
                    </section>
                  ))}
                  <button
                    type="button"
                    onClick={async () => onSettings(await resetModelSettings())}
                    className="justify-self-start font-mono text-xs font-bold text-federal-blue uppercase underline"
                  >
                    Reset to the defaults
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
