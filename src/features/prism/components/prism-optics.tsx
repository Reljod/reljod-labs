"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { MeridianAnswers } from "../domain/api";
import {
  DEPARTMENT_META,
  type DepartmentId,
  SEVERITY_LEVELS,
} from "../domain/questions";
import type { ChuteDecision, ChuteId } from "../domain/routing";

const RAY_COLORS = [
  "#1d4e89", // Routing (Federal Blue)
  "#d9a84e", // Severity (Brass)
  "#b23a2b", // Adversarial (Seal Red)
  "#2f6b3f", // Sign-off (Ivy)
  "#6fa0dc", // Urgency (Clear Sky)
] as const;

/**
 * Centerpiece kinetic SVG optical-mechanical Prism chamber.
 * Shows one incoming Slip beam hitting the faceted crystal prism and splitting
 * simultaneously into 5 calibrated probability rays — with a live ms stopwatch
 * and a "0 OUTPUT TOKENS" mechanical indicator.
 */
export function OpticalPrismChamber({
  answers,
  decision,
  busy,
  latencyMs,
  inputTokens,
  modelName,
  pulseKey,
}: {
  answers: MeridianAnswers;
  decision: ChuteDecision;
  busy: boolean;
  latencyMs: number;
  inputTokens: number;
  modelName: string;
  pulseKey: number;
}) {
  const reduced = useReducedMotion();
  const [liveMs, setLiveMs] = useState(latencyMs);

  useEffect(() => {
    if (!busy) {
      setLiveMs(latencyMs);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      setLiveMs(Math.round(performance.now() - start));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [busy, latencyMs]);

  const topDept = answers.routing.choice as DepartmentId;
  const deptColor = DEPARTMENT_META[topDept]?.color ?? "#1d4e89";
  const topDeptProb =
    answers.routing.probabilities?.[answers.routing.choice] ?? 0.85;

  const rayStrengths = [
    Math.max(0.2, topDeptProb),
    Math.max(0.2, answers.severity.score / 4),
    Math.max(0.18, answers.adversarial.probability),
    Math.max(0.18, answers.humanSignoff.probability),
    Math.max(0.18, answers.urgent.probability),
  ];

  const rayLabels = [
    `DESK · ${DEPARTMENT_META[topDept]?.code ?? topDept.toUpperCase()} ${Math.round(topDeptProb * 100)}%`,
    `RISK · ${answers.severity.score.toFixed(2)} / 4.00`,
    `ADVERSARIAL · ${Math.round(answers.adversarial.probability * 100)}%`,
    `OFFICER · ${Math.round(answers.humanSignoff.probability * 100)}%`,
    `URGENT · ${Math.round(answers.urgent.probability * 100)}%`,
  ];

  const chuteAccent =
    decision.chute === "clear"
      ? "#2f6b3f"
      : decision.chute === "escalate"
        ? "#b23a2b"
        : "#d9a84e";

  return (
    <div className="outline-box relative overflow-hidden rounded-sm bg-paper shadow-hard-md">
      {/* Subtle blueprint drafting grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(20,33,61,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(20,33,61,0.06) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Top instrument header */}
      <div className="relative flex flex-wrap items-center justify-between gap-2 border-ink border-b-2 bg-marble/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full border border-ink ${
              busy ? "bg-brass motion-safe:animate-ping" : "bg-ivy"
            }`}
          />
          <span className="eyebrow font-bold text-ink">
            Single-Pass Optical Chamber
          </span>
          <span className="hidden font-mono text-[11px] text-ink-muted sm:inline">
            · {modelName}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="rounded-sm border border-ink bg-paper px-1.5 py-0.5 font-bold tabular-nums">
            {liveMs} ms
          </span>
          <span className="rounded-sm border border-ink bg-ink px-1.5 py-0.5 font-bold text-brass tabular-nums">
            0 OUT TOK
          </span>
          <span className="hidden rounded-sm border border-ink/40 bg-paper px-1.5 py-0.5 text-ink-muted tabular-nums sm:inline">
            {inputTokens} in
          </span>
        </div>
      </div>

      {/* Main SVG optical stage */}
      <div className="relative px-2 py-3 sm:px-4">
        <svg
          viewBox="0 0 760 228"
          className="h-auto w-full select-none"
          role="img"
          aria-label="Single-forward-pass optical prism splitting one incoming slip into five calibrated probability beams"
        >
          <defs>
            <linearGradient
              id="prism-glass"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
              <stop offset="52%" stopColor="#d6e4f5" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#f5f1e8" stopOpacity="0.94" />
            </linearGradient>
            <linearGradient id="beam-in" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#14213d" stopOpacity="0.2" />
              <stop offset="60%" stopColor="#14213d" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#d9a84e" stopOpacity="1" />
            </linearGradient>
          </defs>

          {/* Left intake node */}
          <g transform="translate(18, 82)">
            <rect
              x="0"
              y="0"
              width="122"
              height="64"
              rx="2"
              fill="#f5f1e8"
              stroke="#14213d"
              strokeWidth="2"
            />
            <rect x="4" y="4" width="122" height="64" rx="2" fill="none" />
            <text
              x="10"
              y="20"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
              fontWeight="700"
              fill="#4a4f5b"
              letterSpacing="1"
            >
              SHARED STATE
            </text>
            <text
              x="10"
              y="38"
              fontSize="12"
              fontFamily="var(--font-mono)"
              fontWeight="700"
              fill="#14213d"
            >
              1 SLIP IN
            </text>
            <text
              x="10"
              y="54"
              fontSize="9"
              fontFamily="var(--font-mono)"
              fill="#1d4e89"
            >
              5 QUESTIONS AT ONCE
            </text>
          </g>

          {/* Incoming beam from Slip into Prism */}
          <line
            x1="140"
            y1="114"
            x2="294"
            y2="114"
            stroke="url(#beam-in)"
            strokeWidth={busy ? 7 : 4.5}
            strokeLinecap="round"
          />

          {/* Animated energy pulse traveling along incoming beam */}
          {!reduced && (
            <motion.circle
              key={`in-pulse-${pulseKey}-${busy ? "busy" : "idle"}`}
              cy="114"
              r={busy ? 6 : 4}
              fill={busy ? "#d9a84e" : "#14213d"}
              initial={{ cx: 146, opacity: 0.9 }}
              animate={{
                cx: [146, 294],
                opacity: [0.2, 1, 0.2],
              }}
              transition={{
                duration: busy ? 0.55 : 2.2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            />
          )}

          {/* Rotating vernier calibration ring behind the Prism */}
          <motion.g
            style={{ originX: "340px", originY: "114px" }}
            animate={reduced ? undefined : { rotate: busy ? 360 : 360 }}
            transition={
              reduced
                ? undefined
                : {
                    duration: busy ? 2.4 : 28,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }
            }
          >
            <circle
              cx="340"
              cy="114"
              r="84"
              fill="none"
              stroke="#14213d"
              strokeOpacity="0.18"
              strokeWidth="1.5"
              strokeDasharray="4 6"
            />
            <circle
              cx="340"
              cy="114"
              r="72"
              fill="none"
              stroke={chuteAccent}
              strokeOpacity="0.4"
              strokeWidth="1"
              strokeDasharray="12 10"
            />
          </motion.g>

          {/* Internal dispersion fan inside the glass triangle */}
          <motion.polygon
            key={`fan-${pulseKey}`}
            points="296,114 388,82 396,144"
            fill={deptColor}
            initial={{ opacity: 0.08 }}
            animate={{ opacity: busy ? [0.15, 0.42, 0.15] : 0.18 }}
            transition={{
              duration: busy ? 0.6 : 0.5,
              repeat: busy ? Number.POSITIVE_INFINITY : 0,
            }}
          />

          {/* 5 Refracted Chromatic Probability Rays */}
          {rayStrengths.map((strength, idx) => {
            const targetY = 30 + idx * 42;
            const exitY = 92 + idx * 11;
            const color = RAY_COLORS[idx];
            const width = 1.6 + strength * 5.4;
            const pathD = `M 380 ${exitY} C 436 ${exitY}, 458 ${targetY}, 518 ${targetY}`;
            return (
              <g key={rayLabels[idx]}>
                {/* Soft halo underneath high-probability rays */}
                <motion.path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeOpacity={0.18}
                  animate={{ strokeWidth: width + 6 }}
                  transition={{ type: "spring", stiffness: 180, damping: 22 }}
                />
                {/* Crisp main refracted ray */}
                <motion.path
                  key={`ray-${idx}-${pulseKey}`}
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  initial={reduced ? false : { pathLength: 0.15, opacity: 0.4 }}
                  animate={{
                    pathLength: 1,
                    opacity: 0.38 + strength * 0.62,
                    strokeWidth: width,
                  }}
                  transition={{
                    pathLength: {
                      duration: 0.42,
                      delay: idx * 0.045,
                      ease: "easeOut",
                    },
                    strokeWidth: {
                      type: "spring",
                      stiffness: 190,
                      damping: 20,
                    },
                  }}
                />
                {/* Moving photon dot */}
                {!reduced && (
                  <motion.circle
                    r={2.2 + strength * 2}
                    fill={color}
                    initial={{ opacity: 0 }}
                    animate={{
                      opacity: [0, 1, 0],
                      cx: [380, 452, 518],
                      cy: [exitY, (exitY + targetY) / 2, targetY],
                    }}
                    transition={{
                      duration: Math.max(0.75, 2.2 - strength * 1.15),
                      delay: idx * 0.14,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut",
                    }}
                  />
                )}
                {/* Right-side calibrated readout pill */}
                <g transform={`translate(524, ${targetY - 13})`}>
                  <rect
                    x="0"
                    y="0"
                    width="218"
                    height="26"
                    rx="2"
                    fill="#ffffff"
                    stroke="#14213d"
                    strokeWidth="1.6"
                  />
                  {/* Live fill bar inside the readout pill */}
                  <motion.rect
                    x="1.5"
                    y="1.5"
                    height="23"
                    fill={color}
                    fillOpacity="0.16"
                    animate={{ width: Math.max(6, strength * 215) }}
                    transition={{ type: "spring", stiffness: 160, damping: 20 }}
                  />
                  <rect x="0" y="0" width="5" height="26" fill={color} />
                  <text
                    x="13"
                    y="16.5"
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fontWeight="700"
                    fill="#14213d"
                    letterSpacing="0.4"
                  >
                    {rayLabels[idx]}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Hard offset shadow of the geometric Prism */}
          <polygon
            points="346,42 406,174 286,174"
            fill="#14213d"
            opacity="0.92"
          />

          {/* Main faceted Colonnade Crystal Prism */}
          <motion.g
            animate={busy && !reduced ? { scale: [1, 1.035, 1] } : { scale: 1 }}
            transition={{
              duration: 0.7,
              repeat: busy ? Number.POSITIVE_INFINITY : 0,
            }}
            style={{ originX: "340px", originY: "114px" }}
          >
            <polygon
              points="340,36 400,168 280,168"
              fill="url(#prism-glass)"
              stroke="#14213d"
              strokeWidth="2.8"
              strokeLinejoin="miter"
            />
            {/* Inner crystal facet lines */}
            <line
              x1="340"
              y1="36"
              x2="340"
              y2="168"
              stroke="#14213d"
              strokeOpacity="0.22"
              strokeWidth="1.2"
            />
            <line
              x1="340"
              y1="114"
              x2="400"
              y2="168"
              stroke="#14213d"
              strokeOpacity="0.18"
              strokeWidth="1"
            />
            <line
              x1="340"
              y1="114"
              x2="280"
              y2="168"
              stroke="#14213d"
              strokeOpacity="0.18"
              strokeWidth="1"
            />
            {/* Center optical jewel */}
            <circle
              cx="340"
              cy="118"
              r="7"
              fill={busy ? "#d9a84e" : chuteAccent}
              stroke="#14213d"
              strokeWidth="2"
            />
            <text
              x="340"
              y="156"
              textAnchor="middle"
              fontSize="8.5"
              fontFamily="var(--font-mono)"
              fontWeight="700"
              fill="#14213d"
              letterSpacing="1.6"
            >
              PRISM
            </text>
          </motion.g>

          {/* Bottom caption inside optical stage */}
          <text
            x="20"
            y="214"
            fontSize="9.5"
            fontFamily="var(--font-mono)"
            fill="#4a4f5b"
          >
            FORWARD PASS: 1 · AUTOREGRESSIVE TOKENS: 0 · CALIBRATED LOGITS →
            PROBABILITIES
          </text>
        </svg>
      </div>
    </div>
  );
}

/**
 * Tactile SVG brass analog needle dial for a calibrated boolean probability P(true).
 */
export function AnalogNeedleDial({
  label,
  sublabel,
  probability,
  tripwire,
  accent,
}: {
  label: string;
  sublabel: string;
  probability: number;
  tripwire?: number;
  accent: string;
}) {
  const clamped = Math.min(1, Math.max(0, probability));
  const angleDeg = -90 + clamped * 180;
  const pct = Math.round(clamped * 100);
  const tripped = tripwire != null && clamped >= tripwire;
  const tripAngle = tripwire != null ? -90 + tripwire * 180 : null;

  return (
    <div
      className={`outline-box relative flex flex-col items-center rounded-sm bg-paper p-3 transition-colors ${
        tripped ? "shadow-[4px_4px_0_#b23a2b]" : "shadow-hard-sm"
      }`}
    >
      <div className="flex w-full items-center justify-between gap-1">
        <span className="eyebrow font-bold text-ink">{label}</span>
        {tripped ? (
          <span className="rounded-sm bg-seal-red px-1.5 py-0.5 font-mono text-[10px] font-bold text-paper uppercase">
            Tripped
          </span>
        ) : (
          <span className="font-mono text-[10px] text-ink-muted uppercase">
            P(true)
          </span>
        )}
      </div>

      <svg
        viewBox="0 0 180 108"
        className="mt-1 h-auto w-full max-w-[180px]"
        role="img"
        aria-label={`${label}: ${pct}% probability`}
      >
        {/* Background semi-circle arc */}
        <path
          d="M 20 92 A 70 70 0 0 1 160 92"
          fill="none"
          stroke="#e4dccb"
          strokeWidth="12"
          strokeLinecap="butt"
        />

        {/* Active probability arc */}
        <motion.path
          d="M 20 92 A 70 70 0 0 1 160 92"
          fill="none"
          stroke={tripped ? "#b23a2b" : accent}
          strokeWidth="12"
          strokeLinecap="butt"
          initial={false}
          animate={{ pathLength: clamped }}
          transition={{ type: "spring", stiffness: 150, damping: 18 }}
        />

        {/* Tick marks at 0, 25, 50, 75, 100 */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const rad = ((-180 + t * 180) * Math.PI) / 180;
          const x1 = 90 + Math.cos(rad) * 58;
          const y1 = 92 + Math.sin(rad) * 58;
          const x2 = 90 + Math.cos(rad) * 78;
          const y2 = 92 + Math.sin(rad) * 78;
          return (
            <line
              key={t}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#14213d"
              strokeWidth={t === 0.5 ? "1.8" : "1"}
              opacity="0.55"
            />
          );
        })}

        {/* Optional threshold tripwire pin */}
        {tripAngle != null && (
          <g transform={`rotate(${tripAngle} 90 92)`}>
            <line
              x1="90"
              y1="14"
              x2="90"
              y2="34"
              stroke="#b23a2b"
              strokeWidth="2.5"
            />
            <polygon points="86,12 94,12 90,20" fill="#b23a2b" />
          </g>
        )}

        {/* Spring-damped brass needle */}
        <motion.g
          style={{ originX: "90px", originY: "92px" }}
          animate={{ rotate: angleDeg }}
          transition={{ type: "spring", stiffness: 170, damping: 15 }}
        >
          <polygon points="87.5,92 92.5,92 90.8,24 89.2,24" fill="#14213d" />
          <circle
            cx="90"
            cy="92"
            r="7"
            fill="#d9a84e"
            stroke="#14213d"
            strokeWidth="2"
          />
        </motion.g>
      </svg>

      <div className="-mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-bold tabular-nums text-ink">
          {pct}%
        </span>
      </div>
      <p className="mt-0.5 text-center text-[11px] text-ink-muted">
        {sublabel}
      </p>
    </div>
  );
}

/**
 * Animated 5-pillar discrete score distribution + sliding brass plumb-bob
 * showing the exact probability-weighted fractional score in [0, 4].
 */
export function SeveritySeismograph({
  score,
  probabilities,
}: {
  score: number;
  probabilities?: Readonly<Record<string, number>>;
}) {
  const pct = Math.min(100, Math.max(0, (score / 4) * 100));
  const barColors = ["#2f6b3f", "#6fa0dc", "#d9a84e", "#b23a2b", "#14213d"];

  return (
    <div className="outline-box flex flex-col justify-between rounded-sm bg-paper p-4 shadow-hard-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="eyebrow font-bold text-ink">Risk Severity Rubric</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Full distribution across levels 0–4, not just a rounded integer
          </p>
        </div>
        <div className="outline-box rounded-sm bg-marble px-2 py-1 text-right font-mono">
          <div className="text-lg leading-none font-bold tabular-nums text-ink">
            {score.toFixed(2)}
          </div>
          <div className="text-[10px] text-ink-muted">/ 4.00</div>
        </div>
      </div>

      {/* 5 probability pillars */}
      <div className="mt-4 grid h-28 grid-cols-5 items-end gap-2 border-ink border-b-2 px-1 pb-1">
        {SEVERITY_LEVELS.map((lvl, idx) => {
          const p =
            probabilities?.[String(lvl.level)] ??
            (Math.round(score) === lvl.level ? 0.75 : 0.06);
          const heightPct = Math.max(5, Math.round(p * 100));
          return (
            <div
              key={lvl.level}
              className="flex h-full flex-col items-center justify-end gap-1"
            >
              <span className="font-mono text-[10px] font-bold tabular-nums text-ink-muted">
                {Math.round(p * 100)}%
              </span>
              <motion.div
                className="w-full rounded-t-[2px] border-2 border-ink"
                style={{ backgroundColor: barColors[idx] }}
                initial={false}
                animate={{ height: `${heightPct}%` }}
                transition={{ type: "spring", stiffness: 180, damping: 20 }}
              />
            </div>
          );
        })}
      </div>

      {/* Labels */}
      <div className="mt-1.5 grid grid-cols-5 text-center font-mono text-[10px] font-bold text-ink-muted">
        {SEVERITY_LEVELS.map((lvl) => (
          <span key={lvl.level}>
            {lvl.short}
            <span className="hidden sm:inline"> · {lvl.label.slice(0, 4)}</span>
          </span>
        ))}
      </div>

      {/* Sliding brass plumb-bob showing expected fractional score */}
      <div className="relative mt-3 h-5">
        <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 bg-limestone" />
        <motion.div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          initial={false}
          animate={{ left: `${pct}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <div className="flex items-center gap-1 rounded-sm border-2 border-ink bg-brass px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink shadow-hard-sm">
            ▼ {score.toFixed(2)}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

const CHUTE_META: Record<
  ChuteId,
  {
    readonly title: string;
    readonly stamp: string;
    readonly color: string;
    readonly bg: string;
    readonly y: number;
    readonly path: string;
  }
> = {
  clear: {
    title: "AUTO-CLEAR",
    stamp: "STRAIGHT-THROUGH",
    color: "#2f6b3f",
    bg: "#e9f3ec",
    y: 36,
    path: "M 54 90 C 175 90, 215 36, 360 36",
  },
  review: {
    title: "HUMAN OFFICER",
    stamp: "HOLD FOR REVIEW",
    color: "#d9a84e",
    bg: "#fbf4e3",
    y: 90,
    path: "M 54 90 C 175 90, 215 90, 360 90",
  },
  escalate: {
    title: "BLOCK & ESCALATE",
    stamp: "ESCALATED",
    color: "#b23a2b",
    bg: "#faeae8",
    y: 144,
    path: "M 54 90 C 175 90, 215 144, 360 144",
  },
};

/**
 * Animated 3-way mechanical railway / pneumatic sorting track.
 * Dragging the Gate sliders flips the active track and shoots a brass capsule
 * down the newly chosen chute with zero additional API calls.
 */
export function PneumaticChuteRouter({
  decision,
}: {
  decision: ChuteDecision;
}) {
  const reduced = useReducedMotion();
  const active = CHUTE_META[decision.chute];

  return (
    <div className="outline-box relative overflow-hidden rounded-sm bg-paper p-4 shadow-hard-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow font-bold text-ink">
            Deterministic Gate &amp; Chute Switch
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Move any threshold slider — code re-routes instantly with{" "}
            <strong className="text-ink">0 model calls</strong>
          </p>
        </div>
        <AnimatePresence mode="wait">
          <motion.span
            key={decision.chute}
            initial={reduced ? false : { scale: 1.45, rotate: -10, opacity: 0 }}
            animate={{ scale: 1, rotate: -2, opacity: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 360, damping: 20 }}
            className="rounded-sm border-2 px-2.5 py-1 font-mono text-xs font-bold tracking-[0.08em] uppercase"
            style={{
              borderColor: active.color,
              color: active.color,
              backgroundColor: active.bg,
            }}
          >
            {active.stamp}
          </motion.span>
        </AnimatePresence>
      </div>

      <svg
        viewBox="0 0 560 180"
        className="mt-3 h-auto w-full select-none"
        role="img"
        aria-label={`Routed to ${active.title}: ${decision.reason}`}
      >
        {/* Inactive tracks */}
        {(["clear", "review", "escalate"] as const).map((id) => {
          const meta = CHUTE_META[id];
          const isCurrent = id === decision.chute;
          return (
            <g key={id}>
              <path
                d={meta.path}
                fill="none"
                stroke={isCurrent ? meta.color : "#e4dccb"}
                strokeWidth={isCurrent ? 10 : 6}
                strokeLinecap="round"
              />
              {isCurrent && (
                <motion.path
                  key={`active-track-${id}`}
                  d={meta.path}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.2"
                  strokeDasharray="6 10"
                  initial={false}
                  animate={reduced ? undefined : { strokeDashoffset: [32, 0] }}
                  transition={{
                    duration: 1.1,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }}
                />
              )}

              {/* Destination chute bay */}
              <g transform={`translate(364, ${meta.y - 20})`}>
                <motion.rect
                  x="0"
                  y="0"
                  width="184"
                  height="40"
                  rx="2"
                  animate={{
                    fill: isCurrent ? meta.bg : "#f5f1e8",
                    stroke: isCurrent ? meta.color : "#14213d",
                    strokeWidth: isCurrent ? 2.6 : 1.4,
                  }}
                  transition={{ duration: 0.2 }}
                />
                <circle
                  cx="16"
                  cy="20"
                  r="5.5"
                  fill={isCurrent ? meta.color : "#e4dccb"}
                  stroke="#14213d"
                  strokeWidth="1.5"
                />
                <text
                  x="30"
                  y="17"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  fontWeight="700"
                  fill="#14213d"
                >
                  {meta.title}
                </text>
                <text
                  x="30"
                  y="31"
                  fontSize="8.5"
                  fontFamily="var(--font-mono)"
                  fill={isCurrent ? meta.color : "#4a4f5b"}
                  fontWeight={isCurrent ? "700" : "500"}
                >
                  {isCurrent ? "● ACTIVE CHUTE" : "STANDBY"}
                </text>
              </g>
            </g>
          );
        })}

        {/* Mechanical switch pivot */}
        <circle
          cx="54"
          cy="90"
          r="18"
          fill="#f5f1e8"
          stroke="#14213d"
          strokeWidth="2.4"
        />
        <text
          x="54"
          y="93"
          textAnchor="middle"
          fontSize="8.5"
          fontFamily="var(--font-mono)"
          fontWeight="700"
          fill="#14213d"
        >
          GATE
        </text>

        {/* Animated brass capsule traveling along the active chute */}
        {!reduced && (
          <motion.circle
            key={`capsule-${decision.chute}`}
            r="8"
            fill="#d9a84e"
            stroke="#14213d"
            strokeWidth="2.2"
            initial={{ cx: 54, cy: 90, scale: 0.7 }}
            animate={{
              cx: [54, 196, 354],
              cy: [90, (90 + active.y) / 2, active.y],
              scale: [0.85, 1.1, 1],
            }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-ink/20 border-t pt-2.5 text-xs">
        <p className="font-medium text-ink">{decision.reason}</p>
        <div className="flex items-center gap-3 font-mono text-[11px] text-ink-muted tabular-nums">
          <span>
            Risk{" "}
            <strong className="text-ink">
              {Math.round(decision.risk * 100)}%
            </strong>
          </span>
          <span>
            Entropy{" "}
            <strong className="text-ink">{decision.entropy.toFixed(2)}</strong>
          </span>
          <span>
            Margin{" "}
            <strong className="text-ink">
              {Math.round(decision.topChoiceMargin * 100)}%
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
}
