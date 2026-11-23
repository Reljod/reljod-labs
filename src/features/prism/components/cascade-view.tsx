"use client";

import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import { useCallback, useRef, useState } from "react";
import type { MeridianAnswers } from "../domain/api";
import {
  DECISION_MODELS,
  type DecisionModelId,
  MODEL_BY_ID,
} from "../domain/models";
import { DEPARTMENT_META, type DepartmentId } from "../domain/questions";
import {
  type ChuteId,
  DEFAULT_THRESHOLDS,
  formatMicroUsd,
  routeChute,
  savingsVsLlm,
  type Thresholds,
} from "../domain/routing";
import { CASCADE_BATCH, type SpecimenSlip } from "../domain/slips";
import { streamCascade } from "./api";

interface SortedItem {
  readonly slip: SpecimenSlip;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly answers: MeridianAnswers;
}

const BINS: readonly {
  readonly id: ChuteId;
  readonly title: string;
  readonly subtitle: string;
  readonly color: string;
  readonly bg: string;
}[] = [
  {
    id: "clear",
    title: "AUTO-CLEAR",
    subtitle: "No LLM needed · straight-through",
    color: "#2f6b3f",
    bg: "#edf5ef",
  },
  {
    id: "review",
    title: "HUMAN REVIEW",
    subtitle: "Gray zone · uncertain or sign-off",
    color: "#d9a84e",
    bg: "#fcf6e8",
  },
  {
    id: "escalate",
    title: "ESCALATE → DEEP MODEL",
    subtitle: "High risk / adversarial · frontier review",
    color: "#b23a2b",
    bg: "#fcedeb",
  },
];

/**
 * Tab 3: The Kinetic Cascade Sorting Machine.
 * Streams 12 Meridian Bank Slips live through a single-forward-pass Decision
 * Model and drops them with spring layoutId physics into 3 chutes. After the
 * run, dragging any threshold slider flies slips physically across bins at
 * 60fps with ZERO additional model calls while recalculating LLM spend saved.
 */
export function CascadeView({
  modelId,
  onModelChange,
}: {
  modelId: DecisionModelId;
  onModelChange: (id: DecisionModelId) => void;
}) {
  const reduced = useReducedMotion();
  const [sorted, setSorted] = useState<SortedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [wallMs, setWallMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const runBatch = useCallback(async (selectedModel: DecisionModelId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setSorted([]);
    setWallMs(0);
    setError(null);
    setInspectedId(null);

    try {
      await streamCascade({
        modelId: selectedModel,
        items: CASCADE_BATCH.map((s) => ({ id: s.id, text: s.text })),
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "item.decided") {
            const slip = CASCADE_BATCH.find((s) => s.id === event.id);
            if (!slip) return;
            setSorted((prev) => [
              ...prev,
              {
                slip,
                latencyMs: event.latencyMs,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                costUsd: event.costUsd,
                answers: event.answers,
              },
            ]);
          } else if (event.type === "item.error") {
            setError(event.error);
          } else if (event.type === "cascade.done") {
            setWallMs(event.wallMs);
          }
        },
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Cascade run failed.");
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, []);

  const sortedIds = new Set(sorted.map((s) => s.slip.id));
  const queued = CASCADE_BATCH.filter((s) => !sortedIds.has(s.id));

  const routed = sorted.map((item) => ({
    ...item,
    decision: routeChute(item.answers, thresholds),
  }));

  const byBin: Record<ChuteId, typeof routed> = {
    clear: routed.filter((r) => r.decision.chute === "clear"),
    review: routed.filter((r) => r.decision.chute === "review"),
    escalate: routed.filter((r) => r.decision.chute === "escalate"),
  };

  const totalInputTokens = sorted.reduce((a, b) => a + b.inputTokens, 0);
  const totalCostUsd = sorted.reduce((a, b) => a + b.costUsd, 0);
  const totalLatency = wallMs || sorted.reduce((a, b) => a + b.latencyMs, 0);
  const economics = savingsVsLlm({
    itemCount: Math.max(1, sorted.length),
    totalInputTokens,
    totalDecisionCostUsd: totalCostUsd,
    totalDecisionMs: Math.max(1, totalLatency),
    escalatedCount: byBin.escalate.length,
  });

  const screenedOutPct =
    sorted.length > 0
      ? Math.round(
          ((sorted.length - byBin.escalate.length) / sorted.length) * 100,
        )
      : 0;

  const inspected = routed.find((r) => r.slip.id === inspectedId) ?? null;

  return (
    <div className="space-y-5">
      {/* Top Dual Mechanical Odometers + Trigger Bar */}
      <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow font-bold text-federal-blue">
              High-Speed Triage Conveyor · 12 Meridian Slips
            </p>
            <h2 className="mt-0.5 font-mono text-lg font-bold uppercase text-ink">
              Screen Out Routine Volume Before Paying For A Generative LLM
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Cascade Decision Model"
              value={modelId}
              disabled={busy}
              onChange={(e) => onModelChange(e.target.value as DecisionModelId)}
              className="rounded-sm border-2 border-ink bg-marble px-2.5 py-1.5 font-mono text-xs font-bold text-ink"
            >
              {DECISION_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortName} (${m.pricePerMillionInput}/M)
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void runBatch(modelId)}
              className="outline-box press rounded-sm bg-ink px-4 py-1.5 font-mono text-xs font-bold tracking-[0.08em] text-paper uppercase disabled:opacity-60"
            >
              {busy
                ? `Sorting ${sorted.length}/${CASCADE_BATCH.length}…`
                : sorted.length > 0
                  ? "Re-Run Cascade ↵"
                  : "Run Sorting Machine ↵"}
            </button>
          </div>
        </div>

        {/* Dual Odometers */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-sm border-2 border-ink bg-marble p-3 font-mono">
            <p className="text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">
              Decision Cascade ({MODEL_BY_ID[modelId].shortName})
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-ivy tabular-nums">
                {formatMicroUsd(totalCostUsd)}
              </span>
              <span className="text-xs font-bold text-ink-muted tabular-nums">
                · 0 out tok
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-ink-muted tabular-nums">
              {sorted.length}/{CASCADE_BATCH.length} slips sorted
              {wallMs > 0 ? ` in ${(wallMs / 1000).toFixed(2)}s` : ""}
            </p>
          </div>

          <div className="rounded-sm border-2 border-ink bg-marble p-3 font-mono">
            <p className="text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">
              If An LLM Wrote JSON For All {Math.max(12, sorted.length)}
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-ink tabular-nums">
                {sorted.length > 0
                  ? formatMicroUsd(economics.llmTotalCostUsd)
                  : "$0.0680"}
              </span>
              <span className="text-xs text-ink-muted tabular-nums">
                · ~
                {sorted.length > 0
                  ? economics.llmOutputTokens.toLocaleString()
                  : "4,320"}{" "}
                tok
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-ink-muted tabular-nums">
              Est. ~
              {sorted.length > 0
                ? (economics.llmTotalMs / 1000).toFixed(1)
                : "22.8"}
              s sequential
            </p>
          </div>

          <div className="rounded-sm border-2 border-ink bg-ink p-3 font-mono text-paper">
            <p className="text-[10px] font-bold tracking-[0.1em] text-brass uppercase">
              Spend Avoided · Deep LLM Calls Skipped
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-brass tabular-nums">
                {sorted.length > 0
                  ? `${economics.costReductionPct.toFixed(1)}%`
                  : "99%+"}
              </span>
              <span className="text-xs text-paper/80 tabular-nums">
                · {sorted.length > 0 ? `${screenedOutPct}% screened` : "ready"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-paper/75">
              Drag sliders below to physically re-sort bins live
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-sm border-2 border-seal-red bg-seal-red/10 px-2.5 py-1.5 font-mono text-xs font-semibold text-seal-red"
          >
            {error}
          </p>
        )}
      </div>

      {/* Live Threshold Re-Sort Bar (Zero-Call Layout Physics!) */}
      <div className="outline-box grid gap-4 rounded-sm bg-paper p-3.5 shadow-hard-sm sm:grid-cols-3">
        <label className="block">
          <div className="flex justify-between font-mono text-[11px] font-bold">
            <span>Auto-Clear Ceiling</span>
            <span className="text-ivy tabular-nums">
              ≤ {Math.round(thresholds.autoClearMaxRisk * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.05}
            max={0.85}
            step={0.01}
            value={thresholds.autoClearMaxRisk}
            onChange={(e) =>
              setThresholds((t) => ({
                ...t,
                autoClearMaxRisk: Math.min(
                  Number(e.target.value),
                  t.escalateMinRisk - 0.06,
                ),
              }))
            }
            className="mt-1 w-full cursor-pointer accent-ink"
          />
        </label>

        <label className="block">
          <div className="flex justify-between font-mono text-[11px] font-bold">
            <span>Escalate Floor</span>
            <span className="text-seal-red tabular-nums">
              ≥ {Math.round(thresholds.escalateMinRisk * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.15}
            max={0.95}
            step={0.01}
            value={thresholds.escalateMinRisk}
            onChange={(e) =>
              setThresholds((t) => ({
                ...t,
                escalateMinRisk: Math.max(
                  Number(e.target.value),
                  t.autoClearMaxRisk + 0.06,
                ),
              }))
            }
            className="mt-1 w-full cursor-pointer accent-ink"
          />
        </label>

        <label className="block">
          <div className="flex justify-between font-mono text-[11px] font-bold">
            <span>Adversarial Tripwire</span>
            <span className="text-seal-red tabular-nums">
              ≥ {Math.round(thresholds.adversarialTripwire * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.15}
            max={0.95}
            step={0.01}
            value={thresholds.adversarialTripwire}
            onChange={(e) =>
              setThresholds((t) => ({
                ...t,
                adversarialTripwire: Number(e.target.value),
              }))
            }
            className="mt-1 w-full cursor-pointer accent-ink"
          />
        </label>
      </div>

      {/* Kinetic Conveyor Belt + 3 Glass-Fronted Sorting Bins */}
      <LayoutGroup id="prism-cascade-bins">
        {/* Intake Conveyor Belt */}
        <div className="outline-box relative overflow-hidden rounded-sm bg-marble p-3 shadow-hard-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow font-bold text-ink">
              Intake Conveyor ({queued.length} waiting)
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-federal-blue">
              <span
                className={`size-2 rounded-full ${busy ? "bg-brass motion-safe:animate-ping" : "bg-ink/30"}`}
              />
              {busy
                ? "PRISM SCANNER ACTIVE"
                : queued.length === 0
                  ? "CONVEYOR CLEARED"
                  : "STANDBY"}
            </span>
          </div>

          <div className="mt-2.5 flex min-h-12 flex-wrap items-center gap-2">
            {queued.length === 0 ? (
              <p className="font-mono text-xs text-ink-muted">
                All 12 slips have passed through the Prism. Drag any gate slider
                above to watch tickets physically jump bins with zero API calls!
              </p>
            ) : (
              queued.map((slip) => (
                <motion.div
                  key={slip.id}
                  layoutId={reduced ? undefined : `cascade-slip-${slip.id}`}
                  className="rounded-sm border-2 border-ink bg-paper px-2.5 py-1.5 font-mono text-[11px] shadow-hard-sm"
                >
                  <span className="font-bold text-ink">{slip.reference}</span>{" "}
                  <span className="text-ink-muted">{slip.title}</span>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* 3 Glass-Fronted Collection Bins */}
        <div className="grid gap-4 lg:grid-cols-3">
          {BINS.map((bin) => {
            const items = byBin[bin.id];
            return (
              <div
                key={bin.id}
                className="outline-box flex min-h-[260px] flex-col rounded-sm bg-paper shadow-hard-md"
              >
                <div
                  className="flex items-center justify-between border-ink border-b-2 px-3 py-2.5"
                  style={{ backgroundColor: bin.bg }}
                >
                  <div>
                    <p
                      className="font-mono text-xs font-bold tracking-[0.08em] uppercase"
                      style={{ color: bin.color }}
                    >
                      {bin.title}
                    </p>
                    <p className="text-[11px] text-ink-muted">{bin.subtitle}</p>
                  </div>
                  <span
                    className="rounded-sm border-2 border-ink bg-paper px-2 py-0.5 font-mono text-sm font-bold tabular-nums"
                    style={{ color: bin.color }}
                  >
                    {items.length}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-3">
                  {items.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-ink/30 p-4 text-center font-mono text-[11px] text-ink-muted">
                      Empty chute
                    </div>
                  ) : (
                    items.map((entry) => {
                      const dept =
                        DEPARTMENT_META[
                          entry.answers.routing.choice as DepartmentId
                        ];
                      const selected = inspectedId === entry.slip.id;
                      return (
                        <motion.button
                          key={entry.slip.id}
                          type="button"
                          layoutId={
                            reduced
                              ? undefined
                              : `cascade-slip-${entry.slip.id}`
                          }
                          layout
                          transition={{
                            type: "spring",
                            stiffness: 260,
                            damping: 24,
                          }}
                          onClick={() =>
                            setInspectedId((prev) =>
                              prev === entry.slip.id ? null : entry.slip.id,
                            )
                          }
                          className={`w-full rounded-sm border-2 border-ink p-2.5 text-left transition-colors ${
                            selected
                              ? "bg-ink text-paper shadow-hard-sm"
                              : "bg-marble/60 text-ink hover:bg-paper"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                            <span className="font-bold">
                              {entry.slip.reference} · {entry.slip.title}
                            </span>
                            <span className="tabular-nums opacity-75">
                              {entry.latencyMs}ms
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                            <span
                              className={`rounded-xs border px-1 py-0.2 font-bold ${
                                selected
                                  ? "border-paper/40 text-brass"
                                  : "border-ink/40 bg-paper text-ink"
                              }`}
                            >
                              {dept?.code ?? entry.answers.routing.choice}
                            </span>
                            <span>
                              Risk{" "}
                              <strong>
                                {Math.round(entry.decision.risk * 100)}%
                              </strong>
                            </span>
                            <span>
                              Adv{" "}
                              <strong>
                                {Math.round(
                                  entry.answers.adversarial.probability * 100,
                                )}
                                %
                              </strong>
                            </span>
                            <span>
                              Sev{" "}
                              <strong>
                                {entry.answers.severity.score.toFixed(1)}
                              </strong>
                            </span>
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Inline Inspected Ticket Spectrum Loupe */}
      <AnimatePresence>
        {inspected && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="outline-box rounded-sm bg-paper p-4 shadow-hard-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow font-bold text-federal-blue">
                  Inspected Slip · {inspected.slip.reference}
                </p>
                <h3 className="font-mono text-sm font-bold text-ink uppercase">
                  {inspected.slip.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectedId(null)}
                className="rounded-sm border border-ink px-2 py-0.5 font-mono text-xs font-bold hover:bg-marble"
              >
                Close ×
              </button>
            </div>
            <p className="mt-2 rounded-sm border border-ink/25 bg-marble/60 p-2.5 text-sm text-ink">
              &ldquo;{inspected.slip.text}&rdquo;
            </p>
            <p className="mt-2 font-mono text-xs text-ink-muted">
              <strong className="text-ink">Gate decision:</strong>{" "}
              {inspected.decision.reason}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
