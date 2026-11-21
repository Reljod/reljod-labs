"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { MARKETS } from "../domain/samples";
import type { HelioModelTier, TelemetryLedgerEntry } from "../domain/types";
import { type ProductPayload, streamTierCompare } from "./api";

type Props = {
  product: ProductPayload;
  productName: string;
  onLogTelemetry: (entry: TelemetryLedgerEntry) => void;
};

type SlotResult = {
  status: "idle" | "running" | "done" | "error";
  model: string;
  imageDataUrl?: string;
  latencyMs?: number;
  costUsd?: number;
  error?: string;
};

/**
 * Live Side-by-Side Model Race:
 * microsoft/mai-image-2.7-flash (~$0.01) vs microsoft/mai-image-2.7 (~$0.034)
 * with synchronized 2.5x optical loupe zoom locked across both photographs.
 */
export function CompareShootout({
  product,
  productName,
  onLogTelemetry,
}: Props) {
  const [marketId, setMarketId] = useState<string>(MARKETS[0].id);
  const [customBrief, setCustomBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [slots, setSlots] = useState<Record<HelioModelTier, SlotResult>>({
    flash: { status: "idle", model: "microsoft/mai-image-2.7-flash" },
    flagship: { status: "idle", model: "microsoft/mai-image-2.7" },
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - start), 70);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function startRace() {
    if (running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setErrorBanner(null);
    setElapsedMs(0);
    setSlots({
      flash: { status: "running", model: "microsoft/mai-image-2.7-flash" },
      flagship: { status: "running", model: "microsoft/mai-image-2.7" },
    });

    try {
      await streamTierCompare(
        {
          product,
          marketId,
          customBrief: customBrief.trim() || undefined,
        },
        (event) => {
          if (event.type === "start") {
            setSlots({
              flash: { status: "running", model: event.flashModel },
              flagship: { status: "running", model: event.flagshipModel },
            });
          } else if (event.type === "result") {
            setSlots((prev) => ({
              ...prev,
              [event.tier]: {
                status: "done",
                model: event.model,
                imageDataUrl: event.imageDataUrl,
                latencyMs: event.latencyMs,
                costUsd: event.costUsd,
              },
            }));
            onLogTelemetry({
              id: `cmp-${event.tier}-${Date.now()}`,
              timestamp: Date.now(),
              operation: "tier-compare",
              model: event.model,
              label: `${event.tier === "flash" ? "Flash 2.7" : "Flagship 2.7"} shootout (${marketId})`,
              latencyMs: event.latencyMs,
              costUsd: event.costUsd,
              meta: "1024×1024 multi-ref race",
            });
          } else if (event.type === "error") {
            setSlots((prev) => ({
              ...prev,
              [event.tier]: {
                ...prev[event.tier],
                status: "error",
                error: event.error,
              },
            }));
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorBanner(
          err instanceof Error ? err.message : "Could not run comparison.",
        );
      }
    } finally {
      setRunning(false);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
    );
    const y = Math.max(
      0,
      Math.min(100, ((e.clientY - rect.top) / rect.height) * 100),
    );
    setLoupe({ x, y });
  }

  const bothReady =
    slots.flash.status === "done" && slots.flagship.status === "done";
  const costRatio =
    slots.flash.costUsd && slots.flagship.costUsd
      ? (
          slots.flagship.costUsd / Math.max(0.0001, slots.flash.costUsd)
        ).toFixed(1)
      : "3.4";

  return (
    <div className="space-y-5">
      {/* Race controls */}
      <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow font-bold text-federal-blue">
              Microsoft Ignite Nov 17, 2026 · Tier Shootout
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-ink">
              MAI Image 2.7 Flash ($0.01) vs MAI Image 2.7 Flagship ($0.034)
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Race both models in parallel on <strong>{productName}</strong>{" "}
              with the exact same reference plate and market lighting brief.
              Hover either finished frame to lock a synchronized 2.5× optical
              loupe across both images.
            </p>
          </div>
          <button
            type="button"
            disabled={running}
            aria-busy={running}
            onClick={startRace}
            className="press rounded-sm border-2 border-ink bg-brass px-4 py-2.5 font-mono text-xs font-black tracking-[0.08em] text-ink uppercase disabled:opacity-55"
          >
            {running
              ? `Racing… ${(elapsedMs / 1000).toFixed(1)}s`
              : "Start Parallel Race →"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <div>
            <label
              htmlFor="helio-compare-market"
              className="eyebrow block text-[10px] font-bold text-ink-muted"
            >
              Test Market Set
            </label>
            <select
              id="helio-compare-market"
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              className="mt-1 w-full rounded-sm border-2 border-ink bg-marble px-3 py-2 font-mono text-xs font-semibold text-ink"
            >
              {MARKETS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.city} — {m.label} ({m.kelvin}K)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="helio-compare-brief"
              className="eyebrow block text-[10px] font-bold text-ink-muted"
            >
              Optional Art-Direction Twist
            </label>
            <input
              id="helio-compare-brief"
              type="text"
              value={customBrief}
              onChange={(e) => setCustomBrief(e.target.value)}
              placeholder="e.g. Rain droplets on glass, subtle warm gold reflection on brushed metal"
              maxLength={240}
              className="mt-1 w-full rounded-sm border-2 border-ink bg-paper px-3 py-2 text-xs text-ink placeholder:text-ink-muted/70"
            />
          </div>
        </div>

        {errorBanner ? (
          <p className="mt-3 rounded-sm border-2 border-seal-red bg-seal-red/10 px-3 py-2 font-mono text-xs font-semibold text-seal-red">
            {errorBanner}
          </p>
        ) : null}
      </div>

      {/* Synchronized Dual Stage */}
      <div className="grid gap-5 md:grid-cols-2">
        {(["flash", "flagship"] as const).map((tier) => {
          const slot = slots[tier];
          const isFlash = tier === "flash";
          return (
            <div
              key={tier}
              className="outline-box flex flex-col overflow-hidden rounded-sm bg-paper shadow-hard-md"
            >
              <div className="flex items-center justify-between border-ink border-b-2 bg-marble px-3.5 py-2">
                <div>
                  <span className="eyebrow text-[10px] font-bold text-federal-blue">
                    {isFlash
                      ? "High-Volume Speed Tier"
                      : "Flagship #1 Editing Tier"}
                  </span>
                  <p className="font-mono text-xs font-bold text-ink">
                    {slot.model}
                  </p>
                </div>
                <div className="text-right font-mono text-xs">
                  {slot.status === "done" && slot.latencyMs ? (
                    <>
                      <p className="font-black text-ink">
                        {(slot.latencyMs / 1000).toFixed(2)}s
                      </p>
                      <p className="text-[10px] font-bold text-ivy">
                        ${(slot.costUsd ?? 0).toFixed(4)} / frame
                      </p>
                    </>
                  ) : slot.status === "running" ? (
                    <span className="font-bold text-brass">
                      {(elapsedMs / 1000).toFixed(1)}s…
                    </span>
                  ) : (
                    <span className="text-[10px] text-ink-muted">
                      {isFlash ? "~$0.010 / img" : "~$0.034 / img"}
                    </span>
                  )}
                </div>
              </div>

              <div
                onPointerMove={handlePointerMove}
                onPointerLeave={() => setLoupe(null)}
                className="relative aspect-square w-full overflow-hidden bg-[#0d1424]"
              >
                {slot.imageDataUrl ? (
                  <>
                    {/* biome-ignore lint/performance/noImgElement: race comparison image */}
                    <img
                      src={slot.imageDataUrl}
                      alt={`${slot.model} output`}
                      className="helio-develop-reveal size-full object-cover"
                    />
                    {/* Synchronized 2.5x Optical Magnifier Loupe */}
                    {bothReady && loupe ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="pointer-events-none absolute z-25 size-36 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-brass shadow-hard-lg"
                        style={{
                          left: `${loupe.x}%`,
                          top: `${loupe.y}%`,
                          backgroundImage: `url(${slot.imageDataUrl})`,
                          backgroundSize: "260%",
                          backgroundPosition: `${loupe.x}% ${loupe.y}%`,
                        }}
                      >
                        <span className="absolute right-1 bottom-1 rounded-[1px] bg-[#0d1424]/85 px-1 font-mono text-[9px] font-bold text-brass">
                          2.5×
                        </span>
                      </motion.div>
                    ) : null}
                  </>
                ) : slot.status === "running" ? (
                  <div className="flex size-full flex-col items-center justify-center gap-3 text-paper">
                    <div className="helio-aperture-orbit size-12 rounded-full border-2 border-dashed border-brass" />
                    <span className="eyebrow text-xs font-bold text-brass">
                      Developing {isFlash ? "Flash 2.7" : "Flagship 2.7"}…
                    </span>
                  </div>
                ) : slot.status === "error" ? (
                  <div className="flex size-full items-center justify-center p-6 text-center font-mono text-xs text-seal-red">
                    {slot.error}
                  </div>
                ) : (
                  <div className="helio-darkroom-grid flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-paper/75">
                    <span className="rounded-sm border border-paper/25 px-2.5 py-1 font-mono text-[10px] font-bold uppercase">
                      Standby · Ready to Race
                    </span>
                    <p className="max-w-xs text-xs text-paper/60">
                      Click “Start Parallel Race” to shoot both tiers side by
                      side and unlock the synchronized 2.5× pixel loupe.
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {bothReady ? (
        <div className="outline-box flex flex-wrap items-center justify-between gap-3 rounded-sm bg-marble px-4 py-3 font-mono text-xs">
          <span className="font-bold text-ink">
            Hover either photograph to inspect synchronized 2.5× micro-detail on
            both tiers simultaneously.
          </span>
          <span className="rounded-sm border border-ink bg-paper px-2 py-0.5 font-bold text-federal-blue">
            Flash 2.7 is {costRatio}× cheaper per image · ideal for rapid
            campaign exploration
          </span>
        </div>
      ) : null}
    </div>
  );
}
