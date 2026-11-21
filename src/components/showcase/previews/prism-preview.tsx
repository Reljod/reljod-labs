import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

const bloom = (delay: number): CSSProperties => ({
  animationDelay: `${delay}s`,
  animationDuration: `${LOOP_SECONDS}s`,
});

const RAYS = [
  { label: "CMP · 64%", width: "64%", color: "bg-brass", delay: 0.55 },
  { label: "FRD · 31%", width: "31%", color: "bg-seal-red", delay: 0.78 },
  { label: "TRS · 5%", width: "12%", color: "bg-federal-blue", delay: 1.0 },
] as const;

/**
 * Prism in miniature (CSS-only animation so the catalog pauses it off-hover):
 * one slip beam hits a Colonnade prism, splits into calibrated probability
 * bars with 0 output tokens, and stamps the routed chute.
 */
export function PrismPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] flex-col justify-between overflow-hidden bg-marble p-[5%]"
    >
      {/* Top strip */}
      <div className="flex items-center justify-between gap-[3%]">
        <span className="outline-box bg-paper px-[2.5%] py-[1%] font-mono text-[0.45rem] font-bold tracking-[0.08em] uppercase shadow-hard-sm">
          1 Forward Pass
        </span>
        <span className="border-2 border-ink bg-ink px-[2.5%] py-[1%] font-mono text-[0.45rem] font-bold tracking-[0.08em] text-brass uppercase">
          0 Output Tokens
        </span>
      </div>

      {/* Middle optical refraction schematic */}
      <div className="outline-box relative flex flex-1 items-center gap-[3%] my-[3.5%] bg-paper px-[4%] py-[4%] shadow-hard-md">
        {/* Incoming beam */}
        <div className="flex w-[22%] flex-col gap-[6%]">
          <div className="border-2 border-ink bg-marble px-[8%] py-[10%] font-mono text-[0.42rem] font-bold uppercase">
            Slip In
          </div>
          <div className="h-1 w-full bg-ink" />
        </div>

        {/* Geometric Colonnade Prism */}
        <svg
          viewBox="0 0 80 76"
          className="h-[72%] w-[24%] shrink-0 overflow-visible"
          aria-hidden="true"
        >
          <polygon points="43,7 75,69 11,69" fill="#14213d" opacity="0.9" />
          <polygon
            points="40,4 72,66 8,66"
            fill="#d6e4f5"
            stroke="#14213d"
            strokeWidth="3"
          />
          <circle
            cx="40"
            cy="44"
            r="6"
            fill="#d9a84e"
            stroke="#14213d"
            strokeWidth="2"
          />
        </svg>

        {/* Refracted probability spectrum */}
        <div className="flex flex-1 flex-col gap-[8%]">
          {RAYS.map((ray) => (
            <div key={ray.label} className="space-y-[3%]">
              <div className="flex justify-between font-mono text-[0.42rem] font-bold text-ink">
                <span>{ray.label}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden border border-ink bg-marble">
                <div
                  className={`h-full origin-left motion-safe:animate-bloom ${ray.color}`}
                  style={{ width: ray.width, ...bloom(ray.delay) }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Stamped verdict */}
        <span
          className="absolute right-[5%] bottom-[8%] border-2 border-seal-red bg-paper px-[2.5%] py-[0.8%] font-mono text-[0.44rem] font-bold tracking-[0.08em] text-seal-red uppercase"
          style={{
            animation: `preview-stamp ${LOOP_SECONDS}s ease-out infinite`,
          }}
        >
          Escalated · 184ms
        </span>
      </div>

      {/* Bottom gate slider hint */}
      <div className="flex items-center gap-[3%] font-mono text-[0.44rem] text-ink-muted uppercase">
        <span>Gate</span>
        <span className="relative h-0.5 flex-1 bg-ink/30">
          <span className="absolute top-1/2 left-[58%] size-2 -translate-y-1/2 border-2 border-ink bg-brass" />
        </span>
        <span className="font-bold text-ivy">99.6% Saved</span>
      </div>
    </div>
  );
}
