"use client";

import { LIMITS } from "../domain/limits";
import type { TelemetryLedgerEntry } from "../domain/types";

export function UnderTheHoodPanel({
  ledger,
}: {
  ledger: TelemetryLedgerEntry[];
}) {
  const totalCost = ledger.reduce((sum, item) => sum + item.costUsd, 0);
  const avgLatency =
    ledger.length > 0
      ? Math.round(
          ledger.reduce((sum, item) => sum + item.latencyMs, 0) / ledger.length,
        )
      : 0;

  return (
    <div className="space-y-5">
      {/* Capability Provenance */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
          <p className="eyebrow text-[10px] font-bold text-federal-blue">
            Nov 17, 2026 · Microsoft Ignite
          </p>
          <h3 className="mt-1 text-base font-bold text-ink">
            MAI Image 2.7 &amp; 2.7-Flash
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Ranked #1 on Artificial Analysis for commercial image editing at
            roughly one-sixth the cost. Supports native RGBA transparent
            background extraction (
            <code className="rounded bg-marble px-1 font-mono text-[11px] text-ink">
              background: &quot;transparent&quot;
            </code>
            ) and multi-reference reasoning-based scene transplanting that
            recomputes shadows, reflections, and wrapped typography.
          </p>
        </div>

        <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
          <p className="eyebrow text-[10px] font-bold text-federal-blue">
            Nov 18, 2026 · Google DeepMind
          </p>
          <h3 className="mt-1 text-base font-bold text-ink">
            Gemini 4 Neon (Vision + Thinking)
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Multimodal reasoning model with configurable{" "}
            <code className="rounded bg-marble px-1 font-mono text-[11px] text-ink">
              thinkingLevel
            </code>{" "}
            (<code className="font-mono text-[11px]">low</code> for fast
            creative direction,{" "}
            <code className="font-mono text-[11px]">medium</code> for forensic
            brand-integrity comparison). Inspects the original RGBA plate and
            staged shot side-by-side to drop pinned spatial audit markers.
          </p>
        </div>

        <div className="outline-box rounded-sm bg-paper p-4 shadow-hard-md">
          <p className="eyebrow text-[10px] font-bold text-ivy">
            Deterministic Verification Layer
          </p>
          <h3 className="mt-1 text-base font-bold text-ink">
            Pure-Code Pixel Telemetry &amp; Caps
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Alpha-channel percentage, Sobel edge sharpness, dominant quantized
            hex swatches, and 16-bin luminance histograms are computed directly
            from Canvas RGBA buffers — never guessed by a model. Uploads pass
            magic-byte inspection before rate caps ({LIMITS.imageCallsPerHour}{" "}
            image calls/hr per visitor) are taken.
          </p>
        </div>
      </div>

      {/* Pipeline diagram */}
      <div className="outline-box rounded-sm bg-[#0d1424] p-4 text-paper shadow-hard-md">
        <p className="eyebrow text-[10px] font-bold text-brass">
          Live Pipeline Architecture
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-4">
          {[
            {
              step: "01 · RGBA PLATE",
              title: "Native Alpha Cutout",
              body: "Specimen plate, uploaded photo isolated via MAI 2.7-Flash transparent mode, or newly synthesized SKU.",
            },
            {
              step: "02 · ART DIRECTION",
              title: "Gemini 4 Neon Brief",
              body: "Reads product materials + target cities, emits kelvin lighting, lens specs, localized copy, and scene prompts.",
            },
            {
              step: "03 · MULTI-REF SHOOT",
              title: "Parallel MAI 2.7 Sets",
              body: "Feeds hero RGBA plate (+ optional mood swatch) into MAI 2.7-Flash / 2.7 in parallel, streaming frames over NDJSON.",
            },
            {
              step: "04 · AUDIT & EXPORT",
              title: "Vision + Code Check",
              body: "Browser Canvas measures optical stats while Neon pins geometry & lighting checks; Canvas renders tear-sheet PNGs.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="rounded-sm border border-paper/20 bg-[#131d33] p-3"
            >
              <span className="font-mono text-[10px] font-bold text-brass">
                {item.step}
              </span>
              <p className="mt-1 text-sm font-bold text-paper">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-paper/70">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Live Session Telemetry Ledger */}
      <div className="outline-box overflow-hidden rounded-sm bg-paper shadow-hard-md">
        <div className="flex flex-wrap items-center justify-between gap-2 border-ink border-b-2 bg-marble px-4 py-2.5">
          <div>
            <span className="eyebrow font-bold text-ink">
              Live Session Gateway Ledger
            </span>
            <p className="font-mono text-[11px] text-ink-muted">
              Every real model call this session with exact Vercel AI Gateway
              cost &amp; latency
            </p>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs font-bold">
            <span className="rounded-sm border border-ink bg-paper px-2 py-0.5 text-ink">
              {ledger.length} calls
            </span>
            <span className="rounded-sm border border-ink bg-paper px-2 py-0.5 text-federal-blue">
              Avg {(avgLatency / 1000).toFixed(1)}s
            </span>
            <span className="rounded-sm border border-ink bg-brass px-2 py-0.5 text-ink">
              Total ${totalCost.toFixed(4)}
            </span>
          </div>
        </div>

        {ledger.length === 0 ? (
          <div className="p-6 text-center font-mono text-xs text-ink-muted">
            No live model calls yet this session. Shoot a campaign, isolate a
            photo, or run a Flash vs Flagship race to populate the ledger.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left font-mono text-xs">
              <thead>
                <tr className="border-ink border-b bg-marble/60 text-[10px] text-ink-muted uppercase">
                  <th className="px-3.5 py-2">Operation</th>
                  <th className="px-3.5 py-2">Model</th>
                  <th className="px-3.5 py-2">Detail</th>
                  <th className="px-3.5 py-2 text-right">Latency</th>
                  <th className="px-3.5 py-2 text-right">Gateway USD</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr
                    key={row.id}
                    className="border-ink/15 border-b last:border-b-0"
                  >
                    <td className="px-3.5 py-2 font-bold text-ink uppercase">
                      {row.operation}
                    </td>
                    <td className="px-3.5 py-2 text-federal-blue">
                      {row.model}
                    </td>
                    <td className="px-3.5 py-2 text-ink-muted">
                      {row.label} · {row.meta}
                    </td>
                    <td className="px-3.5 py-2 text-right font-semibold">
                      {(row.latencyMs / 1000).toFixed(2)}s
                    </td>
                    <td className="px-3.5 py-2 text-right font-bold text-ivy">
                      ${row.costUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
