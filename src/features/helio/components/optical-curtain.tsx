"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type {
  BrandAuditPin,
  BrandAuditResult,
  OpticalTelemetry,
} from "../domain/types";
import { inspectImageInBrowser } from "./api";

type Props = {
  originalPlateSrc: string;
  stagedImageSrc: string;
  versionKey: string;
  marketLabel: string;
  headline: string;
  subcopy: string;
  modelLabel: string;
  latencyMs: number;
  costUsd: number;
  audit?: BrandAuditResult;
  auditing?: boolean;
  editing?: boolean;
  onRunAudit: () => void;
  onTelemetry?: (telemetry: OpticalTelemetry) => void;
};

/**
 * Master Director's Light Table:
 * - Draggable Brass Optical Split-Curtain comparing Original RGBA Plate vs Staged Shot
 * - Silver-halide chemical develop & camera strobe flash on every new version
 * - Animated Gemini 4 Neon Vision Brand-Integrity spatial pins (x%, y%)
 * - Colonnade ink-seal approval stamp
 */
export function OpticalCurtainStage({
  originalPlateSrc,
  stagedImageSrc,
  versionKey,
  marketLabel,
  headline,
  subcopy,
  modelLabel,
  latencyMs,
  costUsd,
  audit,
  auditing = false,
  editing = false,
  onRunAudit,
  onTelemetry,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(0); // 0 = full staged shot visible; drag right to reveal original RGBA cutout
  const [dragging, setDragging] = useState(false);
  const [showPins, setShowPins] = useState(true);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [prevVersionKey, setPrevVersionKey] = useState(versionKey);

  if (prevVersionKey !== versionKey) {
    setPrevVersionKey(versionKey);
    setSplitPct(0);
    setActivePinId(null);
  }

  useEffect(() => {
    let alive = true;
    inspectImageInBrowser(stagedImageSrc)
      .then((res) => {
        if (!alive) return;
        onTelemetry?.(res.telemetry);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stagedImageSrc, onTelemetry]);

  function updateFromClientX(clientX: number) {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(
      0,
      Math.min(100, ((clientX - rect.left) / rect.width) * 100),
    );
    setSplitPct(Math.round(pct));
  }

  const activePin: BrandAuditPin | undefined = audit?.pins.find(
    (p) => p.id === activePinId,
  );

  return (
    <div className="outline-box flex flex-col overflow-hidden rounded-sm bg-paper shadow-hard-md">
      {/* Top optical rail */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-ink border-b-2 bg-marble px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow font-bold text-ink">
            Master Light Table · {marketLabel}
          </span>
          <span className="rounded-sm border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink-muted">
            {modelLabel}
          </span>
          <span className="font-mono text-[10px] font-bold text-federal-blue">
            {(latencyMs / 1000).toFixed(1)}s · ${costUsd.toFixed(4)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSplitPct((p) => (p > 10 ? 0 : 50))}
            className={`rounded-sm border border-ink px-2 py-0.5 font-mono text-[10px] font-bold uppercase transition-colors ${
              splitPct > 0
                ? "bg-brass text-ink"
                : "bg-paper text-ink hover:bg-limestone"
            }`}
          >
            {splitPct > 0 ? "Hide Wipe" : "Wipe vs RGBA"}
          </button>

          {audit ? (
            <button
              type="button"
              onClick={() => setShowPins((v) => !v)}
              aria-pressed={showPins}
              className={`rounded-sm border border-ink px-2 py-0.5 font-mono text-[10px] font-bold uppercase transition-colors ${
                showPins
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink hover:bg-limestone"
              }`}
            >
              {showPins ? `Pins (${audit.pins.length})` : "Show Pins"}
            </button>
          ) : null}

          <button
            type="button"
            disabled={auditing || editing}
            aria-busy={auditing}
            onClick={onRunAudit}
            className="press rounded-sm border-2 border-ink bg-federal-blue px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.06em] text-paper uppercase disabled:opacity-55"
          >
            {auditing
              ? "Neon Auditing…"
              : audit
                ? "Re-Audit Vision"
                : "Audit Brand Integrity"}
          </button>
        </div>
      </div>

      {/* Interactive Lightbox Canvas */}
      <div
        ref={stageRef}
        onPointerMove={(e) => {
          if (dragging) updateFromClientX(e.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className="relative aspect-square w-full overflow-hidden bg-[#0d1424] select-none"
      >
        {/* Right/Full layer: Staged multi-reference photograph */}
        {/* biome-ignore lint/performance/noImgElement: dynamic base64 campaign photograph */}
        <img
          key={versionKey}
          src={stagedImageSrc}
          alt={`${marketLabel} staged campaign shot`}
          draggable={false}
          className="helio-develop-reveal size-full object-cover"
        />

        {/* Left clipped layer: Original Isolated RGBA Plate on checkerboard */}
        {splitPct > 0 ? (
          <div
            className="helio-checker-light absolute inset-0 flex items-center justify-center p-8"
            style={{
              clipPath: `inset(0 ${100 - splitPct}% 0 0)`,
            }}
          >
            {/* biome-ignore lint/performance/noImgElement: dynamic product RGBA cutout */}
            <img
              src={originalPlateSrc}
              alt="Original transparent RGBA product cutout"
              draggable={false}
              className="max-h-[84%] max-w-[84%] object-contain drop-shadow-[0_12px_18px_rgba(20,33,61,0.22)]"
            />
            <span className="absolute top-3 left-3 rounded-sm border border-ink bg-paper/92 px-2 py-0.5 font-mono text-[10px] font-bold text-ink uppercase">
              Original RGBA Plate
            </span>
          </div>
        ) : null}

        {/* Strobe camera flash burst when a new pass develops */}
        <div
          key={`flash-${versionKey}`}
          aria-hidden="true"
          className="helio-flash-burst pointer-events-none absolute inset-0 z-20 bg-paper"
        />

        {/* Brass split-curtain handle */}
        {splitPct > 0 ? (
          <div
            className="absolute inset-y-0 z-30 w-0.5 bg-brass shadow-[0_0_12px_rgba(217,168,78,0.9)]"
            style={{ left: `${splitPct}%` }}
          >
            <button
              type="button"
              aria-label="Drag to compare original RGBA plate and staged photograph"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft")
                  setSplitPct((p) => Math.max(0, p - 5));
                if (e.key === "ArrowRight")
                  setSplitPct((p) => Math.min(100, p + 5));
              }}
              className="absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-sm border-2 border-ink bg-brass font-mono text-xs font-black text-ink shadow-hard-sm"
            >
              ↔
            </button>
          </div>
        ) : null}

        {/* Animated Gemini 4 Neon Vision Brand-Integrity Pins */}
        <AnimatePresence>
          {audit && showPins && splitPct < 85
            ? audit.pins.map((pin, index) => {
                const isSelected = activePinId === pin.id;
                return (
                  <motion.button
                    key={pin.id}
                    type="button"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 340,
                      damping: 20,
                      delay: index * 0.08,
                    }}
                    onClick={() =>
                      setActivePinId((cur) => (cur === pin.id ? null : pin.id))
                    }
                    style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                    className={`absolute z-25 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border-2 border-ink font-mono text-[11px] font-black shadow-hard-sm transition-transform hover:scale-110 ${
                      isSelected
                        ? "bg-ink text-brass ring-2 ring-brass"
                        : pin.status === "pass"
                          ? "bg-brass text-ink"
                          : "bg-seal-red text-paper"
                    }`}
                    title={`${pin.label}: ${pin.detail}`}
                  >
                    {index + 1}
                  </motion.button>
                );
              })
            : null}
        </AnimatePresence>

        {/* Active Pin Inspection Popover */}
        <AnimatePresence>
          {activePin ? (
            <motion.div
              key={activePin.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute right-3 bottom-14 left-3 z-30 rounded-sm border-2 border-ink bg-paper/96 p-3 text-ink shadow-hard-md backdrop-blur-xs sm:left-auto sm:w-80"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="eyebrow text-[10px] font-bold text-federal-blue">
                  {activePin.category} ·{" "}
                  {activePin.status === "pass" ? "Verified" : "Watch"}
                </span>
                <button
                  type="button"
                  onClick={() => setActivePinId(null)}
                  className="font-mono text-xs font-bold text-ink-muted hover:text-ink"
                >
                  ×
                </button>
              </div>
              <p className="mt-1 text-sm font-bold">{activePin.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                {activePin.detail}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Colonnade Brand Approval Stamp */}
        {audit ? (
          <div
            className={`helio-stamp-land pointer-events-none absolute top-3.5 right-3.5 z-25 rounded-sm border-2 px-2.5 py-1 font-mono text-xs font-black tracking-[0.1em] uppercase shadow-hard-sm ${
              audit.verdict === "APPROVED"
                ? "border-ivy bg-paper/95 text-ivy"
                : "border-seal-red bg-paper/95 text-seal-red"
            }`}
          >
            {audit.verdict === "APPROVED" ? "✓ APPROVED" : "! REVISION"} ·{" "}
            {audit.overallScore}/100
          </div>
        ) : null}

        {/* Editorial live caption overlay at bottom */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-15 bg-gradient-to-t from-[#0d1424]/88 via-[#0d1424]/45 to-transparent px-4 pt-8 pb-3 text-paper">
          <p className="font-mono text-[10px] tracking-[0.14em] text-brass uppercase">
            {subcopy}
          </p>
          <p className="mt-0.5 text-lg font-bold tracking-tight sm:text-xl">
            {headline}
          </p>
        </div>

        {/* Editing / Auditing busy veil */}
        {editing || auditing ? (
          <div className="absolute inset-0 z-35 flex flex-col items-center justify-center gap-3 bg-[#0d1424]/78 px-6 text-center text-paper backdrop-blur-[2px]">
            <div className="helio-aperture-orbit size-12 rounded-full border-2 border-dashed border-brass" />
            <p className="eyebrow font-bold text-brass">
              {editing
                ? "Applying Surgical Multi-Ref Edit…"
                : "Gemini 4 Neon Inspecting Lighting & Fidelity…"}
            </p>
            <p className="font-mono text-xs text-paper/75">
              {editing
                ? "Preserving hero silhouette while relighting & blending scene"
                : "Comparing original RGBA plate against staged photograph side-by-side"}
            </p>
          </div>
        ) : null}
      </div>

      {/* Brand Integrity Score Breakdown Bar (when audit is present) */}
      {audit ? (
        <div className="border-ink border-t-2 bg-marble px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink">
              <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-federal-blue uppercase">
                Gemini 4 Neon Audit ·{" "}
              </span>
              {audit.headlineNote}
            </p>
            <span className="font-mono text-[10px] text-ink-muted">
              {audit.reasoningTokens > 0
                ? `${audit.reasoningTokens} thinking tok · `
                : ""}
              {(audit.latencyMs / 1000).toFixed(1)}s · $
              {audit.costUsd.toFixed(4)}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                ["Geometry", audit.scores.geometryFidelity],
                ["Lighting", audit.scores.lightingPhysics],
                ["Materials", audit.scores.materialRealism],
                ["Branding", audit.scores.brandLegibility],
                ["Impact", audit.scores.commercialImpact],
              ] as const
            ).map(([label, score]) => (
              <div
                key={label}
                className="rounded-sm border border-ink bg-paper px-2 py-1"
              >
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-ink-muted uppercase">{label}</span>
                  <span className="font-bold text-ink">{score}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-[1px] bg-limestone">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${score}%` }}
                    transition={{ duration: 0.5 }}
                    className={`h-full ${
                      score >= 88
                        ? "bg-ivy"
                        : score >= 75
                          ? "bg-brass"
                          : "bg-seal-red"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
