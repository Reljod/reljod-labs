"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { calculateRoi } from "../domain/samples";
import type { OpticalTelemetry } from "../domain/types";

/** Pure-code pixel telemetry strip: palette, 16-bin luminance histogram, sharpness, contrast. */
export function OpticalTelemetryStrip({
  telemetry,
}: {
  telemetry: OpticalTelemetry | null;
}) {
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  if (!telemetry) {
    return (
      <div className="outline-box flex items-center justify-between rounded-sm bg-paper px-3 py-2 font-mono text-xs text-ink-muted">
        <span>Measuring pixel telemetry on Canvas…</span>
      </div>
    );
  }

  function copySwatch(hex: string) {
    navigator.clipboard?.writeText(hex).catch(() => {});
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex((cur) => (cur === hex ? null : cur)), 1100);
  }

  return (
    <div className="outline-box grid gap-3 rounded-sm bg-paper p-3 shadow-hard-sm sm:grid-cols-[1.2fr_1fr_1fr]">
      {/* Dominant pixel palette */}
      <div className="flex flex-col justify-between gap-1.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-[10px] font-bold text-ink-muted">
            Code-Sampled Palette
          </span>
          {copiedHex ? (
            <span className="font-mono text-[10px] font-bold text-ivy">
              Copied {copiedHex}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-ink-muted">
              Click swatch
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {telemetry.palette.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => copySwatch(hex)}
              title={`Copy ${hex}`}
              className="group flex flex-1 flex-col items-center gap-1 rounded-[2px] border border-ink p-1 transition-transform hover:-translate-y-0.5"
            >
              <span
                className="h-5 w-full rounded-[1px] border border-ink/30"
                style={{ backgroundColor: hex }}
              />
              <span className="font-mono text-[9px] font-semibold text-ink uppercase">
                {hex.slice(1)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 16-bin luminance histogram */}
      <div className="flex flex-col justify-between gap-1.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-[10px] font-bold text-ink-muted">
            Luminance Distribution
          </span>
          <span className="font-mono text-[10px] font-bold text-ink">
            μ {telemetry.meanLuminance} · Clip {telemetry.highlightClipPct}%
          </span>
        </div>
        <div className="flex h-12 items-end gap-[2px] rounded-[2px] border border-ink bg-marble px-1.5 pt-2 pb-1">
          {telemetry.histogram.map((norm, i) => (
            <motion.span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed 16-bin histogram.
              key={i}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: Math.max(0.06, norm) }}
              transition={{ duration: 0.45, delay: i * 0.018 }}
              className={`h-full flex-1 origin-bottom rounded-t-[1px] ${
                i >= 14
                  ? "bg-seal-red"
                  : i >= 10
                    ? "bg-brass"
                    : "bg-federal-blue"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Sharpness, Contrast & Print Readiness */}
      <div className="flex flex-col justify-between gap-1.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-[10px] font-bold text-ink-muted">
            Optical Telemetry
          </span>
          <span
            className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
              telemetry.printReady
                ? "border-ivy bg-ivy/10 text-ivy"
                : "border-ink bg-marble text-ink-muted"
            }`}
          >
            {telemetry.width}×{telemetry.height}
          </span>
        </div>
        <div className="space-y-1.5">
          <div>
            <div className="flex justify-between font-mono text-[10px]">
              <span className="text-ink-muted">Sobel Sharpness</span>
              <span className="font-bold text-ink">
                {telemetry.sharpnessIndex}/100
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-[1px] border border-ink bg-marble">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${telemetry.sharpnessIndex}%` }}
                transition={{ duration: 0.55 }}
                className="h-full bg-federal-blue"
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between font-mono text-[10px]">
              <span className="text-ink-muted">Dynamic Contrast</span>
              <span className="font-bold text-ink">
                {telemetry.contrastIndex}/100
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-[1px] border border-ink bg-marble">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${telemetry.contrastIndex}%` }}
                transition={{ duration: 0.55 }}
                className="h-full bg-brass"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Executive ROI Odometer comparing Traditional Location Shoot vs Live Helio Shoot. */
export function ExecutiveRoiBar({
  traditionalUsd,
  traditionalDays,
  traditionalCrew,
  aiCostUsd,
  aiElapsedMs,
  readyFrames,
}: {
  traditionalUsd: number;
  traditionalDays: number;
  traditionalCrew: number;
  aiCostUsd: number;
  aiElapsedMs: number;
  readyFrames: number;
}) {
  const aiSeconds = Math.max(1, aiElapsedMs / 1000);
  const roi = calculateRoi({
    traditionalUsd,
    traditionalDays,
    aiCostUsd: aiCostUsd > 0 ? aiCostUsd : 0.033,
    aiSeconds: aiElapsedMs > 0 ? aiSeconds : 15,
    frameCount: Math.max(1, readyFrames),
  });

  const displayCost =
    aiCostUsd > 0 ? `$${aiCostUsd.toFixed(4)}` : "$0.033 (est.)";
  const displayTime =
    aiElapsedMs > 0 ? `${(aiElapsedMs / 1000).toFixed(1)}s` : "~15s";

  return (
    <div className="outline-box grid gap-3 rounded-sm bg-[#0d1424] p-3.5 text-paper shadow-hard-md md:grid-cols-4">
      <div className="border-paper/15 md:border-r md:pr-3">
        <p className="eyebrow text-[10px] text-paper/60">
          Traditional 3-Market Shoot
        </p>
        <p className="mt-1 font-mono text-xl font-bold text-paper/90 line-through decoration-seal-red decoration-2">
          ${traditionalUsd.toLocaleString()}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-paper/60">
          {traditionalDays} days · {traditionalCrew} crew & travel
        </p>
      </div>

      <div className="border-paper/15 md:border-r md:pr-3">
        <p className="eyebrow text-[10px] text-brass">Helio Live AI Studio</p>
        <motion.p
          key={displayCost}
          initial={{ y: -6, opacity: 0.4 }}
          animate={{ y: 0, opacity: 1 }}
          className="mt-1 font-mono text-xl font-bold text-brass"
        >
          {displayCost}
        </motion.p>
        <p className="mt-0.5 font-mono text-[11px] text-paper/75">
          {displayTime} · {Math.max(readyFrames, 3)} global markets · 1 brief
        </p>
      </div>

      <div className="border-paper/15 md:border-r md:pr-3">
        <p className="eyebrow text-[10px] text-clear-sky">Capital Saved</p>
        <p className="mt-1 font-mono text-xl font-bold text-paper">
          ${Math.round(roi.savingsUsd).toLocaleString()}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-clear-sky">
          {roi.costReductionPct.toFixed(2)}% production cost cut
        </p>
      </div>

      <div className="flex flex-col justify-between">
        <p className="eyebrow text-[10px] text-paper/60">Velocity Gain</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold text-paper">
            {roi.speedMultiplier.toLocaleString()}×
          </span>
          <span className="rounded-[2px] border border-brass bg-brass/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brass uppercase">
            Board Ready
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-paper/60">
          Zero agency booking lag
        </p>
      </div>
    </div>
  );
}
