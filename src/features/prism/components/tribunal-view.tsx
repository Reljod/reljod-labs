"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import {
  DECISION_MODELS,
  DEFAULT_JUROR_IDS,
  type DecisionModelId,
  MODEL_BY_ID,
} from "../domain/models";
import { DEPARTMENT_META, type DepartmentId } from "../domain/questions";
import {
  DEFAULT_THRESHOLDS,
  formatMicroUsd,
  type JurorVector,
  jurorAxes,
  routeChute,
  tribunalConsensus,
} from "../domain/routing";
import { SPECIMEN_SLIPS } from "../domain/slips";
import { streamTribunal } from "./api";

const RADAR_AXES: readonly {
  readonly key: keyof JurorVector["axes"];
  readonly label: string;
}[] = [
  { key: "severity", label: "SEVERITY" },
  { key: "urgency", label: "URGENCY" },
  { key: "adversarial", label: "ADVERSARIAL" },
  { key: "humanSignoff", label: "OFFICER" },
  { key: "certainty", label: "CERTAINTY" },
];

function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  index: number,
  total: number,
) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function polygonPoints(
  axes: JurorVector["axes"],
  cx: number,
  cy: number,
  maxR: number,
): string {
  return RADAR_AXES.map((axis, idx) => {
    const r = Math.max(0.08, axes[axis.key]) * maxR;
    const pt = polarPoint(cx, cy, r, idx, RADAR_AXES.length);
    return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }).join(" ");
}

/**
 * Tab 2: Live 4-Model Decision Tribunal.
 * Fires 4 brand-new November 2026 Decision Models in parallel over the same Slip,
 * streams each arrival time live, and overlays their probability polygons on a
 * Polar Constellation Mandala to expose agreement vs split-jury uncertainty.
 */
export function TribunalView() {
  const reduced = useReducedMotion();
  const [selectedSlipId, setSelectedSlipId] = useState("ambiguous-fx");
  const [text, setText] = useState(
    SPECIMEN_SLIPS.find((s) => s.id === "ambiguous-fx")?.text ??
      SPECIMEN_SLIPS[0].text,
  );
  const [selectedModels, setSelectedModels] = useState<DecisionModelId[]>([
    ...DEFAULT_JUROR_IDS,
  ]);
  const [jurors, setJurors] = useState<JurorVector[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [wallMs, setWallMs] = useState<number | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const toggleModel = (id: DecisionModelId) => {
    setSelectedModels((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 2) return prev;
        return prev.filter((m) => m !== id);
      }
      if (prev.length >= 4) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const convene = useCallback(
    async (slipText: string, models: readonly DecisionModelId[]) => {
      const trimmed = slipText.trim();
      if (!trimmed || models.length < 2) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setBusy(true);
      setJurors([]);
      setErrors({});
      setWallMs(null);
      setGlobalError(null);

      try {
        await streamTribunal({
          state: trimmed,
          modelIds: models,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "juror.result") {
              const vec: JurorVector = {
                modelId: event.modelId,
                latencyMs: event.latencyMs,
                costUsd: event.costUsd,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                answers: event.answers,
                decision: routeChute(event.answers, DEFAULT_THRESHOLDS),
                axes: jurorAxes(event.answers),
              };
              setJurors((prev) => [...prev, vec]);
            } else if (event.type === "juror.error") {
              setErrors((prev) => ({ ...prev, [event.modelId]: event.error }));
            } else if (event.type === "tribunal.done") {
              setWallMs(event.wallMs);
            }
          },
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setGlobalError(
          err instanceof Error ? err.message : "Could not convene tribunal.",
        );
      } finally {
        if (abortRef.current === controller) setBusy(false);
      }
    },
    [],
  );

  const summary = tribunalConsensus(jurors);
  const maxLatency = Math.max(450, ...jurors.map((j) => j.latencyMs));
  const totalCost = jurors.reduce((acc, j) => acc + j.costUsd, 0);

  return (
    <div className="space-y-5">
      {/* Control Banner */}
      <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow font-bold text-federal-blue">
              Parallel Multi-Lab Decision Jury
            </p>
            <h2 className="mt-0.5 font-mono text-lg font-bold uppercase text-ink">
              Four Nov 2026 Decision Models · One Slip · Live Race
            </h2>
          </div>
          <button
            type="button"
            disabled={busy || !text.trim() || selectedModels.length < 2}
            aria-busy={busy}
            onClick={() => void convene(text, selectedModels)}
            className="outline-box press rounded-sm bg-ink px-4 py-2 font-mono text-xs font-bold tracking-[0.08em] text-paper uppercase disabled:opacity-60"
          >
            {busy ? "Jury Deliberating…" : "Convene Tribunal ↵"}
          </button>
        </div>

        {/* Juror Model Chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {DECISION_MODELS.map((m) => {
            const active = selectedModels.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                disabled={busy}
                onClick={() => toggleModel(m.id)}
                className={`flex items-center gap-2 rounded-sm border-2 border-ink px-2.5 py-1 font-mono text-xs font-bold transition-colors ${
                  active
                    ? "bg-ink text-paper shadow-hard-sm"
                    : "bg-marble text-ink hover:bg-paper"
                }`}
              >
                <span
                  className="size-2.5 rounded-full border border-paper/60"
                  style={{ backgroundColor: m.accent }}
                />
                <span>{m.shortName}</span>
                <span className="text-[10px] opacity-70">{m.released}</span>
              </button>
            );
          })}
        </div>

        {/* Slip Picker + Editable Input */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {SPECIMEN_SLIPS.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={busy}
              onClick={() => {
                setSelectedSlipId(s.id);
                setText(s.text);
                void convene(s.text, selectedModels);
              }}
              className={`rounded-sm border border-ink px-2 py-0.5 font-mono text-[11px] font-bold ${
                selectedSlipId === s.id
                  ? "bg-brass text-ink"
                  : "bg-marble text-ink hover:bg-paper"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>

        <textarea
          rows={3}
          aria-label="Slip text for Tribunal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-2.5 w-full rounded-sm border-2 border-ink bg-marble/60 p-2.5 text-sm text-ink focus:bg-paper focus:outline-2 focus:outline-federal-blue"
        />

        {globalError && (
          <p
            role="alert"
            className="mt-2 rounded-sm border-2 border-seal-red bg-seal-red/10 px-2.5 py-1.5 font-mono text-xs font-semibold text-seal-red"
          >
            {globalError}
          </p>
        )}
      </div>

      {/* Main Tribunal Stage: Polar Constellation Mandala + Live Millisecond Race Track */}
      <div className="grid gap-5 lg:grid-cols-[1.05fr_1.15fr]">
        {/* Left: Polar Probability Constellation SVG Mandala */}
        <div className="outline-box relative flex flex-col justify-between rounded-sm bg-paper p-4 shadow-hard-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow font-bold text-ink">
                Probability Constellation
              </p>
              <p className="text-xs text-ink-muted">
                Tight overlap = consensus · Fractured polygons = split jury
              </p>
            </div>
            <AnimatePresence mode="wait">
              {summary && (
                <motion.span
                  key={summary.verdict}
                  initial={
                    reduced ? false : { scale: 1.4, rotate: -8, opacity: 0 }
                  }
                  animate={{ scale: 1, rotate: -2, opacity: 1 }}
                  className={`rounded-sm border-2 px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                    summary.verdict === "unanimous"
                      ? "border-ivy bg-ivy/10 text-ivy"
                      : summary.verdict === "majority"
                        ? "border-brass bg-brass/20 text-ink"
                        : "border-seal-red bg-seal-red/10 text-seal-red"
                  }`}
                >
                  {summary.verdict === "unanimous"
                    ? "Unanimous"
                    : summary.verdict === "majority"
                      ? "Majority"
                      : "Split Jury"}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <svg
            viewBox="0 0 340 300"
            className="mx-auto mt-2 h-auto w-full max-w-[360px]"
            role="img"
            aria-label="Polar probability constellation comparing each Decision Model across five risk and certainty axes"
          >
            {/* Concentric vernier rings */}
            {[0.25, 0.5, 0.75, 1].map((ring) => (
              <polygon
                key={ring}
                points={RADAR_AXES.map((_, idx) => {
                  const pt = polarPoint(
                    170,
                    154,
                    ring * 108,
                    idx,
                    RADAR_AXES.length,
                  );
                  return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                }).join(" ")}
                fill={ring === 1 ? "#f5f1e8" : "none"}
                fillOpacity={ring === 1 ? 0.55 : 0}
                stroke="#14213d"
                strokeOpacity={ring === 1 ? 0.45 : 0.16}
                strokeWidth={ring === 1 ? 1.5 : 1}
              />
            ))}

            {/* Spokes & axis labels */}
            {RADAR_AXES.map((axis, idx) => {
              const end = polarPoint(170, 154, 108, idx, RADAR_AXES.length);
              const lbl = polarPoint(170, 154, 128, idx, RADAR_AXES.length);
              const contested =
                summary?.mostContestedAxis === axis.key &&
                summary.maxSpread >= 0.12;
              return (
                <g key={axis.key}>
                  <line
                    x1="170"
                    y1="154"
                    x2={end.x}
                    y2={end.y}
                    stroke={contested ? "#b23a2b" : "#14213d"}
                    strokeOpacity={contested ? 0.65 : 0.2}
                    strokeWidth={contested ? 1.8 : 1}
                  />
                  <text
                    x={lbl.x}
                    y={lbl.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                    fontWeight="700"
                    fill={contested ? "#b23a2b" : "#14213d"}
                  >
                    {axis.label}
                  </text>
                </g>
              );
            })}

            {/* Scanning radar sweep while waiting */}
            {busy && !reduced && (
              <motion.line
                x1="170"
                y1="154"
                x2="170"
                y2="46"
                stroke="#d9a84e"
                strokeWidth="2.5"
                style={{ originX: "170px", originY: "154px" }}
                animate={{ rotate: 360 }}
                transition={{
                  duration: 1.4,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "linear",
                }}
              />
            )}

            {/* One animated probability polygon per arrived Juror */}
            {jurors.map((juror) => {
              const meta = MODEL_BY_ID[juror.modelId];
              const pts = polygonPoints(juror.axes, 170, 154, 108);
              return (
                <motion.polygon
                  key={juror.modelId}
                  points={pts}
                  fill={meta.accent}
                  fillOpacity="0.14"
                  stroke={meta.accent}
                  strokeWidth="2.4"
                  strokeLinejoin="round"
                  initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 180, damping: 18 }}
                  style={{ originX: "170px", originY: "154px" }}
                />
              );
            })}

            {/* Empty prompt hint */}
            {jurors.length === 0 && !busy && (
              <text
                x="170"
                y="158"
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fontWeight="700"
                fill="#4a4f5b"
              >
                PRESS CONVENE TRIBUNAL
              </text>
            )}
          </svg>

          {summary ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-ink/20 border-t pt-2.5 font-mono text-[11px]">
              <span>
                Max spread{" "}
                <strong className="text-ink">
                  σ = {summary.maxSpread.toFixed(2)}
                </strong>{" "}
                on{" "}
                <strong className="text-seal-red uppercase">
                  {summary.mostContestedAxis}
                </strong>
              </span>
              <span className="text-ink-muted tabular-nums">
                4 models total:{" "}
                <strong className="text-ivy">
                  {formatMicroUsd(totalCost)}
                </strong>
              </span>
            </div>
          ) : (
            <p className="mt-2 border-ink/20 border-t pt-2.5 font-mono text-[11px] text-ink-muted">
              Tip: try &ldquo;Borderline FX &amp; Audit Note&rdquo; to see
              models genuinely split on uncertainty vs &ldquo;Quarterly
              Statement Copy&rdquo; for unanimous lock-in.
            </p>
          )}
        </div>

        {/* Right: Live Millisecond Race Track & Juror Scorecards */}
        <div className="outline-box flex flex-col justify-between rounded-sm bg-paper p-4 shadow-hard-md">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="eyebrow font-bold text-ink">
                  Live Millisecond Race Track
                </p>
                <p className="text-xs text-ink-muted">
                  Each juror streams in the exact instant its single forward
                  pass lands
                </p>
              </div>
              {wallMs != null && (
                <span className="rounded-sm border border-ink bg-marble px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums">
                  Wall: {wallMs} ms
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {selectedModels.map((id) => {
                const meta = MODEL_BY_ID[id];
                const arrivedIdx = jurors.findIndex((j) => j.modelId === id);
                const juror = arrivedIdx >= 0 ? jurors[arrivedIdx] : null;
                const err = errors[id];
                const barPct = juror
                  ? Math.max(
                      10,
                      Math.min(100, (juror.latencyMs / maxLatency) * 100),
                    )
                  : 0;
                const dept = juror
                  ? DEPARTMENT_META[
                      juror.answers.routing.choice as DepartmentId
                    ]
                  : null;

                return (
                  <div
                    key={id}
                    className="rounded-sm border-2 border-ink bg-marble/50 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-3 rounded-xs border border-ink"
                          style={{ backgroundColor: meta.accent }}
                        />
                        <span className="font-mono text-xs font-bold text-ink">
                          {meta.name}
                        </span>
                        <span className="font-mono text-[10px] text-ink-muted">
                          {meta.released}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        {juror ? (
                          <>
                            <span className="rounded-xs bg-ink px-1.5 py-0.5 font-bold text-brass">
                              #{arrivedIdx + 1}
                            </span>
                            <span className="font-bold tabular-nums text-ink">
                              {juror.latencyMs} ms
                            </span>
                            <span className="text-ink-muted">· 0 tok</span>
                          </>
                        ) : err ? (
                          <span className="font-bold text-seal-red">Error</span>
                        ) : busy ? (
                          <span className="text-ink-muted motion-safe:animate-pulse">
                            Racing…
                          </span>
                        ) : (
                          <span className="text-ink-muted">Ready</span>
                        )}
                      </div>
                    </div>

                    {/* Animated latency race bar */}
                    <div className="mt-2 h-3 w-full overflow-hidden rounded-xs border border-ink bg-paper">
                      {juror ? (
                        <motion.div
                          className="h-full"
                          style={{ backgroundColor: meta.accent }}
                          initial={reduced ? false : { width: 0 }}
                          animate={{ width: `${barPct}%` }}
                          transition={{
                            type: "spring",
                            stiffness: 180,
                            damping: 20,
                          }}
                        />
                      ) : busy && !err ? (
                        <motion.div
                          className="h-full w-1/3 opacity-50"
                          style={{ backgroundColor: meta.accent }}
                          animate={
                            reduced ? undefined : { x: ["-100%", "350%"] }
                          }
                          transition={{
                            duration: 1.1,
                            repeat: Number.POSITIVE_INFINITY,
                            ease: "linear",
                          }}
                        />
                      ) : null}
                    </div>

                    {juror && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-xs border border-ink bg-paper px-1.5 py-0.5 font-bold">
                            {dept?.label ?? juror.answers.routing.choice}
                          </span>
                          <span>
                            Sev{" "}
                            <strong>
                              {juror.answers.severity.score.toFixed(2)}
                            </strong>
                          </span>
                          <span>
                            Adv{" "}
                            <strong>
                              {Math.round(
                                juror.answers.adversarial.probability * 100,
                              )}
                              %
                            </strong>
                          </span>
                          <span>
                            Urg{" "}
                            <strong>
                              {Math.round(
                                juror.answers.urgent.probability * 100,
                              )}
                              %
                            </strong>
                          </span>
                        </div>
                        <span
                          className={`rounded-xs border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            juror.decision.chute === "clear"
                              ? "border-ivy bg-ivy/10 text-ivy"
                              : juror.decision.chute === "escalate"
                                ? "border-seal-red bg-seal-red/10 text-seal-red"
                                : "border-brass bg-brass/20 text-ink"
                          }`}
                        >
                          {juror.decision.chute}
                        </span>
                      </div>
                    )}

                    {err && (
                      <p className="mt-1.5 font-mono text-[11px] text-seal-red">
                        {err}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
