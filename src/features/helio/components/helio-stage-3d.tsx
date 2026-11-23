"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { BackdropMode, OpticalTelemetry } from "../domain/types";
import { inspectImageInBrowser } from "./api";

type Props = {
  imageSrc: string;
  productName: string;
  brand: string;
  category: string;
  accentHex: string;
  busy?: boolean;
  busyLabel?: string;
  onTelemetry?: (telemetry: OpticalTelemetry) => void;
};

/**
 * Interactive 3D spring-physics RGBA Light Table.
 * Pointer motion drives subtle 3D plate tilt, dynamic directional brass rim-light
 * sweep, and floating cast shadow — visually proving native RGBA transparency.
 */
export function HelioStage3D({
  imageSrc,
  productName,
  brand,
  category,
  accentHex,
  busy = false,
  busyLabel,
  onTelemetry,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [backdrop, setBackdrop] = useState<BackdropMode>("alpha");
  const [xray, setXray] = useState(false);
  const [telemetry, setTelemetry] = useState<OpticalTelemetry | null>(null);
  const [xraySrc, setXraySrc] = useState<string>("");

  const rawX = useMotionValue(0.5);
  const rawY = useMotionValue(0.5);
  const springCfg = { stiffness: 190, damping: 22, mass: 0.7 };
  const smoothX = useSpring(rawX, springCfg);
  const smoothY = useSpring(rawY, springCfg);

  const rotateY = useSpring(useMotionValue(0), springCfg);
  const rotateX = useSpring(useMotionValue(0), springCfg);
  const shadowX = useSpring(useMotionValue(0), springCfg);
  const shadowY = useSpring(useMotionValue(18), springCfg);

  const spotlight = useMotionTemplate`radial-gradient(380px circle at calc(${smoothX} * 100%) calc(${smoothY} * 100%), rgba(217, 168, 78, 0.24), transparent 68%)`;

  useEffect(() => {
    let alive = true;
    inspectImageInBrowser(imageSrc)
      .then((res) => {
        if (!alive) return;
        setTelemetry(res.telemetry);
        setXraySrc(res.alphaXrayDataUrl);
        onTelemetry?.(res.telemetry);
      })
      .catch(() => {
        // Non-fatal if canvas decode fails
      });
    return () => {
      alive = false;
    };
  }, [imageSrc, onTelemetry]);

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    rawX.set(nx);
    rawY.set(ny);
    rotateY.set((nx - 0.5) * 18);
    rotateX.set((0.5 - ny) * 14);
    shadowX.set((0.5 - nx) * 26);
    shadowY.set(16 + (0.5 - ny) * 16);
  }

  function handlePointerLeave() {
    rawX.set(0.5);
    rawY.set(0.5);
    rotateX.set(0);
    rotateY.set(0);
    shadowX.set(0);
    shadowY.set(18);
  }

  const backdropClass =
    backdrop === "alpha"
      ? "helio-checker-light"
      : backdrop === "obsidian"
        ? "helio-darkroom-grid"
        : "bg-marble";

  const darkSurface = backdrop === "obsidian" || xray;

  return (
    <div className="outline-box flex flex-col overflow-hidden rounded-sm bg-paper shadow-hard-md">
      {/* Optical header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-ink border-b-2 bg-marble px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-2.5 border border-ink"
            style={{ backgroundColor: accentHex }}
          />
          <span className="eyebrow font-bold text-ink">
            01 · Native RGBA Plate
          </span>
          {telemetry ? (
            <span className="rounded-sm border border-ink bg-paper px-1.5 py-0.5 font-mono text-[10px] font-bold text-federal-blue">
              {telemetry.transparentPct}% ALPHA
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["alpha", "Alpha Grid"],
              ["obsidian", "Darkroom"],
              ["marble", "Marble"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setXray(false);
                setBackdrop(id);
              }}
              aria-pressed={!xray && backdrop === id}
              className={`rounded-sm border border-ink px-2 py-0.5 font-mono text-[10px] font-bold uppercase transition-colors ${
                !xray && backdrop === id
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink hover:bg-limestone"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setXray((v) => !v)}
            aria-pressed={xray}
            className={`rounded-sm border border-ink px-2 py-0.5 font-mono text-[10px] font-bold uppercase transition-colors ${
              xray
                ? "bg-brass text-ink"
                : "bg-paper text-ink hover:bg-limestone"
            }`}
          >
            Alpha X-Ray
          </button>
        </div>
      </div>

      {/* 3D Interactive Stage */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className={`relative aspect-square w-full overflow-hidden select-none transition-colors duration-300 ${
          xray ? "bg-[#0d1424]" : backdropClass
        }`}
        style={{ perspective: 950 }}
      >
        {/* Dynamic cursor-tracked brass light rig beam */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10"
          style={{ background: spotlight }}
        />

        {/* Corner architectural registration crop marks */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className={`pointer-events-none absolute inset-0 z-10 size-full ${
            darkSurface ? "text-paper/35" : "text-ink/30"
          }`}
        >
          <path
            d="M4 10 V4 H10 M90 4 H96 V10 M96 90 V96 H90 M10 96 H4 V90"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
          />
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke="currentColor"
            strokeDasharray="1.5 2.5"
            strokeWidth="0.35"
          />
        </svg>

        {/* Ground cast shadow shifting in 3D parallax */}
        {!xray ? (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[12%] left-1/2 z-0 h-8 w-[52%] -translate-x-1/2 rounded-full blur-xl"
            style={{
              x: shadowX,
              y: shadowY,
              backgroundColor:
                backdrop === "obsidian"
                  ? "rgba(0,0,0,0.72)"
                  : "rgba(20,33,61,0.34)",
            }}
          />
        ) : null}

        {/* Floating RGBA product plate */}
        <motion.div
          className="relative z-10 flex size-full items-center justify-center p-7"
          style={{
            rotateX,
            rotateY,
            transformStyle: "preserve-3d",
          }}
        >
          {/* biome-ignore lint/performance/noImgElement: dynamic base64 RGBA plate animated by motion */}
          <motion.img
            key={`${imageSrc}-${xray ? "xray" : "rgb"}`}
            src={xray && xraySrc ? xraySrc : imageSrc}
            alt={`${productName} transparent studio plate`}
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 24 }}
            draggable={false}
            className={`max-h-[88%] max-w-[88%] object-contain ${
              xray
                ? "rounded-sm border border-brass/50"
                : "drop-shadow-[0_14px_22px_rgba(20,33,61,0.22)]"
            }`}
          />
        </motion.div>

        {/* Animated brass optical scanline during Alpha X-Ray */}
        {xray ? (
          <div
            aria-hidden="true"
            className="helio-xray-beam pointer-events-none absolute inset-x-0 top-0 z-20 h-[3px] bg-brass shadow-[0_0_16px_2px_rgba(217,168,78,0.85)]"
          />
        ) : null}

        {/* Busy extraction overlay */}
        {busy ? (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#0d1424]/82 px-6 text-center text-paper backdrop-blur-[2px]">
            <div className="helio-aperture-orbit size-12 rounded-full border-2 border-dashed border-brass" />
            <p className="eyebrow font-bold text-brass">
              {busyLabel || "Extracting Native RGBA Alpha…"}
            </p>
            <p className="font-mono text-xs text-paper/75">
              microsoft/mai-image-2.7-flash · background: transparent
            </p>
          </div>
        ) : null}

        {/* Bottom HUD caption */}
        <div className="pointer-events-none absolute inset-x-3 bottom-2.5 z-20 flex items-end justify-between gap-2">
          <div
            className={`rounded-sm border px-2 py-1 backdrop-blur-xs ${
              darkSurface
                ? "border-paper/25 bg-[#0d1424]/80 text-paper"
                : "border-ink bg-paper/90 text-ink"
            }`}
          >
            <p className="font-mono text-[10px] font-bold tracking-[0.08em] uppercase opacity-75">
              {brand}
            </p>
            <p className="text-xs font-bold leading-tight">{productName}</p>
          </div>
          <span
            className={`rounded-sm border px-2 py-1 font-mono text-[10px] font-bold uppercase ${
              darkSurface
                ? "border-brass/60 bg-[#0d1424]/80 text-brass"
                : "border-ink bg-paper/90 text-ink-muted"
            }`}
          >
            {xray ? "BRASS = FEATHERED EDGE" : "TILT TO INSPECT ALPHA"}
          </span>
        </div>
      </div>

      {/* Material & Optical Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-ink border-t-2 bg-paper px-3 py-2">
        <span className="font-mono text-[11px] text-ink-muted">{category}</span>
        {telemetry ? (
          <div className="flex items-center gap-1.5">
            {telemetry.palette.slice(0, 4).map((hex) => (
              <span
                key={hex}
                title={hex}
                className="inline-block size-3.5 rounded-[1px] border border-ink"
                style={{ backgroundColor: hex }}
              />
            ))}
            <span className="ml-1 font-mono text-[10px] font-bold text-ink">
              {telemetry.width}×{telemetry.height}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
