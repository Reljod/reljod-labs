"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { findMarket } from "../domain/samples";
import type { CampaignFrame, OpticalTelemetry } from "../domain/types";

type Props = {
  productName: string;
  brand: string;
  priceTag: string;
  originalPlateSrc: string;
  frames: CampaignFrame[];
  telemetry: OpticalTelemetry | null;
  onJumpToStudio: () => void;
};

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

/**
 * Live Executive Campaign Placements Wall:
 * Renders the AI-shot photographs immediately inside Flagship Billboard,
 * Mobile Launch Story, Luxury Editorial Tear-Sheet, and Global Retail Triptych
 * — plus 1-click high-res Canvas Poster PNG export!
 */
export function PlacementsWall({
  productName,
  brand,
  priceTag,
  originalPlateSrc,
  frames,
  telemetry,
  onJumpToStudio,
}: Props) {
  const readyFrames = frames.filter(
    (f) => f.status === "ready" && f.versions[f.activeVersionIndex],
  );
  const [exporting, setExporting] = useState(false);

  const heroFrame = readyFrames[0];
  const heroVersion = heroFrame?.versions[heroFrame.activeVersionIndex];
  const heroMarket = heroFrame ? findMarket(heroFrame.marketId) : undefined;
  const heroSrc = heroVersion?.imageDataUrl || originalPlateSrc;
  const heroHeadline =
    heroFrame?.direction?.headline ||
    heroMarket?.defaultHeadline ||
    "Precision, distilled.";
  const heroSubcopy =
    heroFrame?.direction?.subcopy ||
    heroMarket?.defaultSubcopy ||
    `${brand} · Global Launch Edition`;

  async function exportExecutivePoster() {
    setExporting(true);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not load image."));
        el.src = heroSrc;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1120;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Colonnade marble paper backdrop
      ctx.fillStyle = "#f5f1e8";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Architectural 4px ink frame
      ctx.strokeStyle = "#14213d";
      ctx.lineWidth = 4;
      ctx.strokeRect(36, 36, 1528, 1048);

      // Left photograph bay (square 960x960)
      ctx.fillStyle = "#0d1424";
      ctx.fillRect(72, 72, 960, 960);
      ctx.drawImage(img, 72, 72, 960, 960);
      ctx.strokeStyle = "#14213d";
      ctx.lineWidth = 4;
      ctx.strokeRect(72, 72, 960, 960);

      // Right editorial column
      const colX = 1076;
      ctx.fillStyle = "#1d4e89";
      ctx.font = "700 20px monospace";
      ctx.fillText(brand.toUpperCase(), colX, 118);

      ctx.fillStyle = "#14213d";
      ctx.font = "800 44px system-ui, sans-serif";
      const words = heroHeadline.split(" ");
      let line = "";
      let y = 182;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > 450) {
          ctx.fillText(line, colX, y);
          line = word;
          y += 54;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, colX, y);

      ctx.fillStyle = "#4a4f5b";
      ctx.font = "600 22px monospace";
      ctx.fillText(heroSubcopy.slice(0, 36), colX, y + 48);

      // Brass divider rule
      ctx.fillStyle = "#d9a84e";
      ctx.fillRect(colX, y + 82, 440, 6);

      // Product metadata
      ctx.fillStyle = "#14213d";
      ctx.font = "700 24px system-ui, sans-serif";
      ctx.fillText(productName, colX, y + 140);
      ctx.fillStyle = "#4a4f5b";
      ctx.font = "500 20px monospace";
      ctx.fillText(`RETAIL · ${priceTag}`, colX, y + 178);
      if (heroMarket) {
        ctx.fillText(
          `MARKET · ${heroMarket.city.toUpperCase()} (${heroMarket.kelvin}K)`,
          colX,
          y + 214,
        );
      }

      // Extracted palette swatches
      const swatches = telemetry?.palette ?? [
        "#14213d",
        "#1d4e89",
        "#d9a84e",
        "#f5f1e8",
      ];
      ctx.fillStyle = "#4a4f5b";
      ctx.font = "700 16px monospace";
      ctx.fillText("SAMPLED COLOR SPECIFICATION", colX, 740);
      swatches.slice(0, 5).forEach((hex, idx) => {
        const sx = colX + idx * 88;
        ctx.fillStyle = hex;
        ctx.fillRect(sx, 760, 72, 56);
        ctx.strokeStyle = "#14213d";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, 760, 72, 56);
        ctx.fillStyle = "#14213d";
        ctx.font = "700 14px monospace";
        ctx.fillText(hex.toUpperCase(), sx, 838);
      });

      // Footer provenance
      ctx.fillStyle = "#14213d";
      ctx.fillRect(colX, 916, 440, 116);
      ctx.fillStyle = "#d9a84e";
      ctx.font = "700 16px monospace";
      ctx.fillText("PRODUCED BY HELIO AI STUDIO", colX + 22, 956);
      ctx.fillStyle = "#f5f1e8";
      ctx.font = "500 15px monospace";
      ctx.fillText("MAI IMAGE 2.7 + GEMINI 4 NEON", colX + 22, 988);
      ctx.fillText(
        heroVersion
          ? `SHOT IN ${(heroVersion.latencyMs / 1000).toFixed(1)}S · $${heroVersion.costUsd.toFixed(4)}`
          : "NATIVE RGBA SPECIMEN PLATE",
        colX + 22,
        1014,
      );

      const url = canvas.toDataURL("image/png");
      triggerDownload(
        url,
        `helio-tear-sheet-${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Action Header */}
      <div className="outline-box flex flex-wrap items-center justify-between gap-3 rounded-sm bg-paper p-4 shadow-hard-md">
        <div>
          <p className="eyebrow font-bold text-federal-blue">
            Executive Launch Kit · Live Media Mockups
          </p>
          <h2 className="mt-0.5 text-lg font-bold text-ink">
            {readyFrames.length > 0
              ? `${readyFrames.length} global campaign frames typeset across 4 live channels`
              : "Previewing your RGBA studio plate — shoot a campaign in Studio to populate live city sets"}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {readyFrames.length === 0 ? (
            <button
              type="button"
              onClick={onJumpToStudio}
              className="press rounded-sm border-2 border-ink bg-brass px-3.5 py-2 font-mono text-xs font-bold text-ink uppercase"
            >
              ← Shoot Campaign First
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              triggerDownload(
                originalPlateSrc,
                `helio-rgba-cutout-${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
              )
            }
            className="press rounded-sm border-2 border-ink bg-paper px-3 py-2 font-mono text-xs font-bold text-ink uppercase"
          >
            Download RGBA Cutout
          </button>
          <button
            type="button"
            disabled={exporting}
            aria-busy={exporting}
            onClick={exportExecutivePoster}
            className="press rounded-sm border-2 border-ink bg-ink px-3.5 py-2 font-mono text-xs font-bold text-paper uppercase disabled:opacity-55"
          >
            {exporting ? "Rendering 1600px PNG…" : "Export Tear-Sheet PNG"}
          </button>
        </div>
      </div>

      {/* Placement Grid: 16:9 Flagship Billboard + 9:16 Mobile Launch Story */}
      <div className="grid gap-5 lg:grid-cols-[1.65fr_1fr]">
        {/* 1. Architectural Flagship Billboard (16:9) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="outline-box flex flex-col overflow-hidden rounded-sm bg-[#0d1424] text-paper shadow-hard-md"
        >
          <div className="flex items-center justify-between border-paper/15 border-b px-3.5 py-2">
            <span className="eyebrow text-[10px] font-bold text-brass">
              Channel 01 · Flagship Out-of-Home Billboard (16:9)
            </span>
            <span className="font-mono text-[10px] text-paper/65">
              {heroMarket?.city || "Studio"} · 4K Digital OOH
            </span>
          </div>
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            {/* biome-ignore lint/performance/noImgElement: dynamic placement preview */}
            <img
              src={heroSrc}
              alt="Billboard preview"
              className="size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0d1424]/88 via-[#0d1424]/35 to-transparent" />
            <div className="absolute inset-y-0 left-0 flex max-w-[62%] flex-col justify-between p-5 sm:p-7">
              <div className="flex items-center gap-2">
                <span className="rounded-[2px] border border-brass bg-brass px-1.5 py-0.5 font-mono text-[10px] font-black text-ink uppercase">
                  {brand}
                </span>
                <span className="font-mono text-[10px] tracking-[0.12em] text-paper/80 uppercase">
                  {heroFrame?.direction?.localizedBadge || "NEW RELEASE"}
                </span>
              </div>
              <div>
                <h3 className="text-2xl font-black leading-[1.05] tracking-tight text-paper sm:text-4xl">
                  {heroHeadline}
                </h3>
                <p className="mt-2 font-mono text-xs text-brass">
                  {heroSubcopy}
                </p>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] text-paper/85">
                <span className="font-bold">{productName}</span>
                <span aria-hidden="true">·</span>
                <span className="text-brass">{priceTag}</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* 2. Mobile Flagship Launch Story (9:16 feel) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="outline-box flex flex-col overflow-hidden rounded-sm bg-paper shadow-hard-md"
        >
          <div className="flex items-center justify-between border-ink border-b-2 bg-marble px-3.5 py-2">
            <span className="eyebrow text-[10px] font-bold text-ink">
              Channel 02 · Mobile Social Drop (4:5)
            </span>
            <span className="font-mono text-[10px] text-ink-muted">
              Paid Social Ready
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center bg-limestone/45 p-4">
            <div className="outline-box relative aspect-[4/5] w-full max-w-[270px] overflow-hidden rounded-sm bg-[#0d1424] text-paper shadow-hard-md">
              {/* biome-ignore lint/performance/noImgElement: dynamic mobile story preview */}
              <img
                src={
                  readyFrames[1]?.versions[readyFrames[1].activeVersionIndex]
                    ?.imageDataUrl || heroSrc
                }
                alt="Mobile social story preview"
                className="size-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-[#0d1424]/55 via-transparent to-[#0d1424]/92" />
              {/* Story progress bars */}
              <div className="absolute inset-x-3 top-2.5 flex gap-1">
                <span className="h-0.5 flex-1 bg-brass" />
                <span className="h-0.5 flex-1 bg-paper/40" />
                <span className="h-0.5 flex-1 bg-paper/40" />
              </div>
              <div className="absolute top-5 left-3 right-3 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold tracking-[0.1em] uppercase">
                  {brand}
                </span>
                <span className="rounded-[2px] border border-paper/40 bg-[#0d1424]/70 px-1.5 py-0.5 font-mono text-[9px] font-bold text-brass">
                  {priceTag}
                </span>
              </div>
              <div className="absolute inset-x-3 bottom-3 space-y-2">
                <p className="text-lg font-black leading-tight">
                  {readyFrames[1]?.direction?.headline || heroHeadline}
                </p>
                <div className="flex items-center justify-between rounded-[2px] border border-brass bg-brass px-2.5 py-1.5 font-mono text-[10px] font-black text-ink uppercase">
                  <span>Reserve Flagship Drop</span>
                  <span>→</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* 3. Global Retail Flagship Triptych (all developed markets side-by-side) */}
      {readyFrames.length > 0 ? (
        <div className="outline-box overflow-hidden rounded-sm bg-paper shadow-hard-md">
          <div className="flex flex-wrap items-center justify-between gap-2 border-ink border-b-2 bg-marble px-3.5 py-2">
            <span className="eyebrow text-[10px] font-bold text-ink">
              Channel 03 · Global Retail Window Triptych
            </span>
            <span className="font-mono text-[10px] text-ink-muted">
              Same SKU silhouette locked across every regional campaign
            </span>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            {readyFrames.map((frame) => {
              const ver = frame.versions[frame.activeVersionIndex];
              const market = findMarket(frame.marketId);
              if (!ver) return null;
              return (
                <div
                  key={frame.marketId}
                  className="outline-box flex flex-col overflow-hidden rounded-sm bg-paper shadow-hard-sm"
                >
                  <div className="relative aspect-square overflow-hidden bg-[#0d1424]">
                    {/* biome-ignore lint/performance/noImgElement: triptych frame */}
                    <img
                      src={ver.imageDataUrl}
                      alt={`${market?.city ?? frame.marketId} retail poster`}
                      className="size-full object-cover"
                    />
                    <span className="absolute top-2 left-2 rounded-[2px] border border-ink bg-paper/92 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink uppercase">
                      {market?.city} · {market?.country}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col justify-between gap-2 p-3">
                    <div>
                      <p className="text-sm font-bold text-ink">
                        {frame.direction?.headline || market?.defaultHeadline}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                        {frame.direction?.subcopy || market?.defaultSubcopy}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        triggerDownload(
                          ver.imageDataUrl,
                          `helio-${frame.marketId}-${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
                        )
                      }
                      className="rounded-sm border border-ink bg-marble px-2.5 py-1 font-mono text-[10px] font-bold text-ink uppercase hover:bg-limestone"
                    >
                      Download 1024px PNG
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
