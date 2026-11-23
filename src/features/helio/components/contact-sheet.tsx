"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { findMarket } from "../domain/samples";
import type { CampaignFrame } from "../domain/types";

type Props = {
  frames: CampaignFrame[];
  selectedMarketId: string | null;
  onSelectMarket: (marketId: string) => void;
  onSelectVersion: (marketId: string, versionIndex: number) => void;
};

function LiveStopwatch({ running }: { running: boolean }) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const id = setInterval(() => setMs(Date.now() - start), 80);
    return () => clearInterval(id);
  }, [running]);
  return <span>{(ms / 1000).toFixed(1)}s</span>;
}

/**
 * 35mm Darkroom Contact Sheet Strip with sprocket perforations, live developing
 * timers, shared layoutId selection frame, and non-destructive version scrubber.
 */
export function ContactSheetStrip({
  frames,
  selectedMarketId,
  onSelectMarket,
  onSelectVersion,
}: Props) {
  if (frames.length === 0) return null;

  const selectedFrame = frames.find((f) => f.marketId === selectedMarketId);

  return (
    <div className="outline-box overflow-hidden rounded-sm bg-[#0d1424] text-paper shadow-hard-md">
      {/* Top 35mm film sprockets */}
      <div className="flex items-center justify-between border-paper/15 border-b px-3 py-1.5">
        <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-brass uppercase">
          HELIO 120MM · MULTI-MARKET CONTACT SHEET
        </span>
        <span className="font-mono text-[10px] text-paper/60 uppercase">
          {frames.filter((f) => f.status === "ready").length}/{frames.length}{" "}
          DEVELOPED
        </span>
      </div>
      <div aria-hidden="true" className="helio-sprockets h-2.5 w-full" />

      {/* Film frames grid */}
      <div className="grid gap-3 px-3 py-2.5 sm:grid-cols-3">
        {frames.map((frame, index) => {
          const market = findMarket(frame.marketId);
          const activeVersion = frame.versions[frame.activeVersionIndex];
          const isSelected = frame.marketId === selectedMarketId;
          const isWorking =
            frame.status === "directing" || frame.status === "developing";

          return (
            <button
              key={frame.marketId}
              type="button"
              onClick={() => onSelectMarket(frame.marketId)}
              className={`group relative flex flex-col overflow-hidden rounded-sm border-2 text-left transition-transform hover:-translate-y-0.5 ${
                isSelected
                  ? "border-brass bg-[#15203a]"
                  : "border-paper/20 bg-[#10192d] hover:border-paper/45"
              }`}
            >
              {isSelected ? (
                <motion.div
                  layoutId="helio-contact-ring"
                  className="pointer-events-none absolute inset-0 z-20 border-2 border-brass"
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                />
              ) : null}

              {/* Frame meta bar */}
              <div className="flex items-center justify-between border-paper/15 border-b px-2.5 py-1 font-mono text-[10px]">
                <span className="font-bold text-brass">
                  EXP {String(index + 1).padStart(2, "0")}A ·{" "}
                  {market?.city.toUpperCase()}
                </span>
                <span className="text-paper/65">
                  {activeVersion ? (
                    `${(activeVersion.latencyMs / 1000).toFixed(1)}s`
                  ) : isWorking ? (
                    <LiveStopwatch running />
                  ) : (
                    `${market?.kelvin ?? 5000}K`
                  )}
                </span>
              </div>

              {/* Frame visual */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#0a101e]">
                {activeVersion ? (
                  <>
                    {/* biome-ignore lint/performance/noImgElement: dynamic base64 frame */}
                    <img
                      src={activeVersion.imageDataUrl}
                      alt={`${market?.label ?? frame.marketId} shot`}
                      className="helio-develop-reveal size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    {activeVersion.audit ? (
                      <span
                        className={`absolute top-1.5 right-1.5 rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] font-black uppercase ${
                          activeVersion.audit.verdict === "APPROVED"
                            ? "border-ivy bg-paper/95 text-ivy"
                            : "border-seal-red bg-paper/95 text-seal-red"
                        }`}
                      >
                        {activeVersion.audit.overallScore}/100
                      </span>
                    ) : null}
                    {frame.versions.length > 1 ? (
                      <span className="absolute bottom-1.5 left-1.5 rounded-[2px] border border-paper/30 bg-[#0d1424]/85 px-1.5 py-0.5 font-mono text-[9px] font-bold text-brass uppercase">
                        {frame.versions.length} Passes
                      </span>
                    ) : null}
                  </>
                ) : frame.status === "error" ? (
                  <div className="flex size-full flex-col items-center justify-center gap-1 p-3 text-center">
                    <span className="font-mono text-[10px] font-bold text-seal-red uppercase">
                      Exposure Failed
                    </span>
                    <span className="line-clamp-2 font-mono text-[10px] text-paper/65">
                      {frame.error}
                    </span>
                  </div>
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center">
                    <div className="helio-aperture-orbit size-7 rounded-full border-2 border-dashed border-brass/80" />
                    <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-brass uppercase">
                      {frame.status === "directing"
                        ? "Neon Directing…"
                        : "MAI Developing…"}
                    </span>
                  </div>
                )}
              </div>

              {/* Localized headline strip */}
              <div className="px-2.5 py-1.5">
                <p className="truncate text-xs font-bold text-paper">
                  {frame.direction?.headline ||
                    market?.defaultHeadline ||
                    market?.label}
                </p>
                <p className="truncate font-mono text-[10px] text-paper/60">
                  {frame.direction?.lightingSpec ||
                    `${market?.kelvin}K · ${market?.lens}`}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom 35mm film sprockets */}
      <div aria-hidden="true" className="helio-sprockets h-2.5 w-full" />

      {/* Non-destructive Pass History Scrubber for the selected market */}
      {selectedFrame && selectedFrame.versions.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-paper/15 border-t bg-[#111b31] px-3 py-2">
          <span className="font-mono text-[10px] font-bold text-paper/65 uppercase">
            Edit History:
          </span>
          {selectedFrame.versions.map((ver, idx) => (
            <button
              key={ver.id}
              type="button"
              onClick={() => onSelectVersion(selectedFrame.marketId, idx)}
              className={`rounded-[2px] border px-2 py-0.5 font-mono text-[10px] font-bold transition-colors ${
                idx === selectedFrame.activeVersionIndex
                  ? "border-brass bg-brass text-ink"
                  : "border-paper/25 bg-transparent text-paper/80 hover:border-paper/60"
              }`}
            >
              {ver.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
