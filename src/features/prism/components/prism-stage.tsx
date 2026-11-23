"use client";

import { motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import type { MeridianAnswers } from "../domain/api";
import {
  DECISION_MODELS,
  type DecisionModelId,
  MODEL_BY_ID,
} from "../domain/models";
import {
  DEPARTMENT_IDS,
  DEPARTMENT_META,
  type DepartmentId,
} from "../domain/questions";
import {
  DEFAULT_THRESHOLDS,
  formatMicroUsd,
  routeChute,
  savingsVsLlm,
  shannonEntropy,
  type Thresholds,
} from "../domain/routing";
import {
  INITIAL_SPECIMEN_REFRACTION,
  SLIP_NUDGES,
  SPECIMEN_SLIPS,
  type SpecimenSlip,
} from "../domain/slips";
import { refractSlip } from "./api";
import {
  AnalogNeedleDial,
  OpticalPrismChamber,
  PneumaticChuteRouter,
  SeveritySeismograph,
} from "./prism-optics";

interface RefractionState {
  readonly modelId: DecisionModelId;
  readonly source: "specimen" | "live";
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly answers: MeridianAnswers;
}

export function PrismStage({
  modelId,
  onModelChange,
}: {
  modelId: DecisionModelId;
  onModelChange: (id: DecisionModelId) => void;
}) {
  const [selectedSlipId, setSelectedSlipId] = useState(SPECIMEN_SLIPS[0].id);
  const [text, setText] = useState(SPECIMEN_SLIPS[0].text);
  const [refraction, setRefraction] = useState<RefractionState>({
    modelId: INITIAL_SPECIMEN_REFRACTION.modelId,
    source: INITIAL_SPECIMEN_REFRACTION.source,
    latencyMs: INITIAL_SPECIMEN_REFRACTION.latencyMs,
    inputTokens: INITIAL_SPECIMEN_REFRACTION.inputTokens,
    outputTokens: INITIAL_SPECIMEN_REFRACTION.outputTokens,
    costUsd: INITIAL_SPECIMEN_REFRACTION.costUsd,
    answers: INITIAL_SPECIMEN_REFRACTION.answers,
  });
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulseKey, setPulseKey] = useState(1);

  const abortRef = useRef<AbortController | null>(null);
  const inflightRef = useRef(false);

  const runLive = useCallback(
    async (nextText: string, nextModelId: DecisionModelId) => {
      const trimmed = nextText.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inflightRef.current = true;
      setBusy(true);
      setError(null);

      try {
        const res = await refractSlip({
          modelId: nextModelId,
          state: trimmed,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setRefraction({
          modelId: res.modelId,
          source: "live",
          latencyMs: res.latencyMs,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          costUsd: res.costUsd,
          answers: res.answers as unknown as MeridianAnswers,
        });
        setPulseKey((k) => k + 1);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Refraction failed.");
      } finally {
        if (abortRef.current === controller) {
          inflightRef.current = false;
          setBusy(false);
        }
      }
    },
    [],
  );

  const pickSlip = (slip: SpecimenSlip) => {
    setSelectedSlipId(slip.id);
    setText(slip.text);
    void runLive(slip.text, modelId);
  };

  const applyNudge = (append: string) => {
    const mutated = `${text.trim()}${append}`;
    setText(mutated);
    void runLive(mutated, modelId);
  };

  const decision = routeChute(refraction.answers, thresholds);
  const entropy = shannonEntropy(refraction.answers.routing.probabilities);
  const economics = savingsVsLlm({
    itemCount: 1,
    totalInputTokens: refraction.inputTokens,
    totalDecisionCostUsd: refraction.costUsd,
    totalDecisionMs: refraction.latencyMs,
    escalatedCount: decision.chute === "escalate" ? 1 : 0,
  });

  const activeSlip =
    SPECIMEN_SLIPS.find((s) => s.id === selectedSlipId) ?? SPECIMEN_SLIPS[0];

  const sortedDepartments = [...DEPARTMENT_IDS].sort((a, b) => {
    const pa = refraction.answers.routing.probabilities?.[a] ?? 0;
    const pb = refraction.answers.routing.probabilities?.[b] ?? 0;
    return pb - pa;
  });

  return (
    <div className="space-y-5">
      {/* Top Slip Selector Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow font-bold text-ink-muted">
            Specimen Slips
          </span>
          {SPECIMEN_SLIPS.map((slip) => {
            const active = slip.id === selectedSlipId;
            return (
              <button
                key={slip.id}
                type="button"
                disabled={busy}
                onClick={() => pickSlip(slip)}
                className={`rounded-sm border-2 border-ink px-2.5 py-1 font-mono text-xs font-bold transition-[translate,box-shadow,background-color] ${
                  active
                    ? "bg-ink text-paper shadow-hard-sm"
                    : "press bg-paper text-ink hover:bg-morning-haze/50"
                }`}
              >
                {slip.title}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-sm border border-ink bg-paper px-2 py-0.5 font-mono text-[11px] font-bold uppercase">
            {refraction.source === "live"
              ? `● Live · ${MODEL_BY_ID[refraction.modelId].shortName}`
              : "Specimen · click Refract for live pass"}
          </span>
        </div>
      </div>

      {/* Hero Row: Editable Specimen Slip + Optical Prism Chamber */}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.55fr]">
        {/* Left: Specimen Slip Card */}
        <div className="outline-box flex flex-col justify-between rounded-sm bg-paper p-4 shadow-hard-md">
          <div>
            <div className="flex items-center justify-between gap-2 border-ink border-b-2 pb-2">
              <div>
                <p className="eyebrow font-bold text-federal-blue">
                  {activeSlip.channel}
                </p>
                <p className="font-mono text-xs text-ink-muted">
                  {activeSlip.reference} · {activeSlip.sender}
                </p>
              </div>
              <span className="rounded-sm border-2 border-seal-red px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-seal-red uppercase">
                Specimen
              </span>
            </div>

            <label htmlFor="prism-slip-input" className="sr-only">
              Incoming bank slip text
            </label>
            <textarea
              id="prism-slip-input"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) {
                  e.preventDefault();
                  void runLive(text, modelId);
                }
              }}
              placeholder="Paste any message, wire note, or claim to refract in one forward pass…"
              className="mt-3 w-full resize-y rounded-sm border-2 border-ink bg-marble/60 p-3 font-sans text-sm leading-relaxed text-ink focus:bg-paper focus:outline-2 focus:outline-federal-blue"
            />

            {/* Live adversarial & policy mutation nudges */}
            <div className="mt-3">
              <p className="eyebrow text-[10px] font-bold text-ink-muted">
                Nudge the slip live &amp; watch probabilities swing
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SLIP_NUDGES.map((nudge) => (
                  <button
                    key={nudge.id}
                    type="button"
                    disabled={busy}
                    onClick={() => applyNudge(nudge.append)}
                    className={`rounded-sm border border-ink px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                      nudge.tone === "danger"
                        ? "bg-seal-red/10 text-seal-red hover:bg-seal-red hover:text-paper"
                        : nudge.tone === "warn"
                          ? "bg-brass/20 text-ink hover:bg-brass"
                          : "bg-ivy/10 text-ivy hover:bg-ivy hover:text-paper"
                    }`}
                  >
                    {nudge.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-ink/20 border-t pt-3">
            <select
              aria-label="Decision Model"
              value={modelId}
              onChange={(e) => {
                const next = e.target.value as DecisionModelId;
                onModelChange(next);
                void runLive(text, next);
              }}
              className="rounded-sm border-2 border-ink bg-marble px-2.5 py-1.5 font-mono text-xs font-bold text-ink"
            >
              {DECISION_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.released})
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={busy || !text.trim()}
              aria-busy={busy}
              onClick={() => void runLive(text, modelId)}
              className="outline-box press rounded-sm bg-ink px-4 py-1.5 font-mono text-xs font-bold tracking-[0.08em] text-paper uppercase disabled:opacity-60"
            >
              {busy ? "Refracting…" : "Refract Slip ↵"}
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-2 rounded-sm border-2 border-seal-red bg-seal-red/10 px-2.5 py-1.5 font-mono text-xs font-semibold text-seal-red"
            >
              {error}
            </p>
          )}
        </div>

        {/* Right: Optical Prism Chamber */}
        <OpticalPrismChamber
          answers={refraction.answers}
          decision={decision}
          busy={busy}
          latencyMs={refraction.latencyMs}
          inputTokens={refraction.inputTokens}
          modelName={MODEL_BY_ID[refraction.modelId].name}
          pulseKey={pulseKey}
        />
      </div>

      {/* Middle Row: Department Spectrum + Severity Seismograph + 3 Analog Needles */}
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        {/* Choice Spectrum Card */}
        <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow font-bold text-ink">
                Desk Routing Spectrum
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Calibrated distribution across all 5 desks (sums to 100%)
              </p>
            </div>
            <span
              className={`rounded-sm border-2 px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${
                entropy >= thresholds.maxUncertainty
                  ? "border-brass bg-brass/20 text-ink"
                  : "border-ivy bg-ivy/10 text-ivy"
              }`}
            >
              H = {entropy.toFixed(2)} ·{" "}
              {entropy >= thresholds.maxUncertainty ? "Uncertain" : "Decisive"}
            </span>
          </div>

          <div className="mt-4 space-y-2.5">
            {sortedDepartments.map((dept) => {
              const meta = DEPARTMENT_META[dept as DepartmentId];
              const p = refraction.answers.routing.probabilities?.[dept] ?? 0;
              const pct = Math.round(p * 1000) / 10;
              const winner = refraction.answers.routing.choice === dept;
              return (
                <div key={dept} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-mono font-bold text-ink">
                      <span
                        className="inline-block size-2.5 rounded-xs border border-ink"
                        style={{ backgroundColor: meta.color }}
                      />
                      {meta.label}
                      {winner && (
                        <span className="rounded-xs bg-ink px-1 py-0.2 text-[9px] text-paper uppercase">
                          Top
                        </span>
                      )}
                    </span>
                    <span className="font-mono font-bold tabular-nums text-ink">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-xs border-2 border-ink bg-marble">
                    <motion.div
                      className="h-full"
                      style={{ backgroundColor: meta.color }}
                      initial={false}
                      animate={{ width: `${Math.max(1.5, pct)}%` }}
                      transition={{
                        type: "spring",
                        stiffness: 170,
                        damping: 22,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Severity Seismograph */}
        <SeveritySeismograph
          score={refraction.answers.severity.score}
          probabilities={refraction.answers.severity.probabilities}
        />
      </div>

      {/* Three Calibrated Brass Needle Dials */}
      <div className="grid gap-4 sm:grid-cols-3">
        <AnalogNeedleDial
          label="Adversarial / Evasion"
          sublabel="Injection, spoof, or threshold evasion"
          probability={refraction.answers.adversarial.probability}
          tripwire={thresholds.adversarialTripwire}
          accent="#b23a2b"
        />
        <AnalogNeedleDial
          label="Human Sign-Off"
          sublabel="Requires bank officer approval"
          probability={refraction.answers.humanSignoff.probability}
          tripwire={0.55}
          accent="#d9a84e"
        />
        <AnalogNeedleDial
          label="Same-Day Urgency"
          sublabel="Cutoff, emergency, or active incident"
          probability={refraction.answers.urgent.probability}
          accent="#1d4e89"
        />
      </div>

      {/* Bottom Row: Kinetic Chute Router + Zero-Call Live Threshold Gates */}
      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <PneumaticChuteRouter decision={decision} />

        {/* Brass Threshold Gate Controls */}
        <div className="outline-box flex flex-col justify-between rounded-sm bg-paper p-4 shadow-hard-md">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow font-bold text-ink">Live Threshold Gates</p>
              <button
                type="button"
                onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
                className="font-mono text-[11px] font-bold text-federal-blue underline hover:text-ink"
              >
                Reset
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Calibrated probabilities turn policy tuning into deterministic
              sliders — no prompt rewrites, no extra inference.
            </p>

            <div className="mt-4 space-y-3.5">
              <GateSlider
                label="Auto-Clear Risk Ceiling"
                value={thresholds.autoClearMaxRisk}
                accent="#2f6b3f"
                format={(v) => `≤ ${Math.round(v * 100)}%`}
                onChange={(v) =>
                  setThresholds((t) => ({
                    ...t,
                    autoClearMaxRisk: Math.min(v, t.escalateMinRisk - 0.08),
                  }))
                }
              />
              <GateSlider
                label="Escalate Risk Floor"
                value={thresholds.escalateMinRisk}
                accent="#b23a2b"
                format={(v) => `≥ ${Math.round(v * 100)}%`}
                onChange={(v) =>
                  setThresholds((t) => ({
                    ...t,
                    escalateMinRisk: Math.max(v, t.autoClearMaxRisk + 0.08),
                  }))
                }
              />
              <GateSlider
                label="Adversarial Tripwire"
                value={thresholds.adversarialTripwire}
                accent="#b23a2b"
                format={(v) => `≥ ${Math.round(v * 100)}%`}
                onChange={(v) =>
                  setThresholds((t) => ({ ...t, adversarialTripwire: v }))
                }
              />
              <GateSlider
                label="Uncertainty Cap (Entropy H)"
                value={thresholds.maxUncertainty}
                accent="#d9a84e"
                format={(v) => `H ≥ ${v.toFixed(2)}`}
                onChange={(v) =>
                  setThresholds((t) => ({ ...t, maxUncertainty: v }))
                }
              />
            </div>
          </div>

          {/* Micro-economics comparison strip */}
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-sm border-2 border-ink bg-marble p-2.5 font-mono text-[11px]">
            <div>
              <div className="text-[10px] text-ink-muted uppercase">
                This Pass
              </div>
              <div className="font-bold text-ivy tabular-nums">
                {formatMicroUsd(refraction.costUsd)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-muted uppercase">
                LLM JSON Est.
              </div>
              <div className="font-bold text-ink tabular-nums">
                {formatMicroUsd(economics.llmTotalCostUsd)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-muted uppercase">Saved</div>
              <div className="font-bold text-federal-blue tabular-nums">
                {economics.costReductionPct.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GateSlider({
  label,
  value,
  accent,
  format,
  onChange,
}: {
  label: string;
  value: number;
  accent: string;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono font-bold text-ink">{label}</span>
        <span
          className="rounded-xs border border-ink px-1.5 py-0.2 font-mono text-[11px] font-bold tabular-nums"
          style={{ color: accent }}
        >
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={0.05}
        max={0.95}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-2 w-full cursor-pointer accent-ink"
      />
    </label>
  );
}
