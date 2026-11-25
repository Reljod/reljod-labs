import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

const FRAMES = [
  { city: "TOKYO", kelvin: "4100K", bg: "#1d4e89", accent: "#6fa0dc" },
  { city: "MILAN", kelvin: "5200K", bg: "#c26345", accent: "#d9a84e" },
  { city: "MANILA", kelvin: "3100K", bg: "#6b4226", accent: "#d9a84e" },
] as const;

const cardAnim = (index: number): CSSProperties => ({
  animationName: "helio-preview-card",
  animationDuration: `${LOOP_SECONDS}s`,
  animationDelay: `${0.5 + index * 0.45}s`,
  animationIterationCount: "infinite",
  animationTimingFunction: "ease-out",
  animationFillMode: "both",
});

/** Helio in miniature: one RGBA studio plate refracted into 3 market shoots with an approval stamp. */
export function HelioPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] flex-col gap-[4%] overflow-hidden bg-[#0d1424] p-[5%] text-paper"
    >
      {/* Top optical plate strip */}
      <div className="relative flex flex-[1.15] items-center justify-between gap-[4%] overflow-hidden border-2 border-paper/30 bg-[#15203a] px-[4%] py-[3%]">
        {/* Checkerboard RGBA tile */}
        <div
          className="relative flex aspect-square h-full items-center justify-center overflow-hidden border-2 border-brass bg-[#ebe5d8]"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #d7cebc 25%, transparent 25%), linear-gradient(-45deg, #d7cebc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d7cebc 75%), linear-gradient(-45deg, transparent 75%, #d7cebc 75%)",
            backgroundSize: "10px 10px",
            backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0",
          }}
        >
          {/* Minimal terracotta vessel silhouette */}
          <svg
            aria-hidden="true"
            viewBox="0 0 64 64"
            className="h-[78%] w-[78%] drop-shadow-[0_2px_3px_rgba(20,33,61,0.35)]"
          >
            <path
              d="M24 14h16v5H24z"
              fill="#6b4226"
              stroke="#14213d"
              strokeWidth="2"
            />
            <path
              d="M21 20h22l5 28c0 5-5 8-16 8s-16-3-16-8z"
              fill="#c26345"
              stroke="#14213d"
              strokeWidth="2"
            />
            <path
              d="M21 28 C12 24, 10 18, 7 18"
              fill="none"
              stroke="#d9a84e"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <path
              d="M44 26 C53 26, 54 42, 46 44"
              fill="none"
              stroke="#6b4226"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </svg>
          {/* Sweeping brass light beam */}
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-[38%] bg-gradient-to-r from-transparent via-brass/60 to-transparent"
            style={{
              animation: `helio-preview-beam ${LOOP_SECONDS}s ease-in-out infinite`,
            }}
          />
        </div>

        <div className="flex flex-1 flex-col justify-between self-stretch py-[2%]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.44rem] font-bold tracking-[0.1em] text-brass uppercase">
              RGBA · MAI 2.7
            </span>
            <span
              className="border border-ivy bg-paper px-[3%] py-[1%] font-mono text-[0.42rem] font-black text-ivy uppercase"
              style={{
                animation: `preview-stamp ${LOOP_SECONDS}s ease-out infinite both`,
              }}
            >
              ✓ 96/100
            </span>
          </div>
          <p className="font-mono text-[0.52rem] font-bold leading-tight text-paper">
            1 RGBA cutout → 3 relit flagship markets
          </p>
          <div className="flex items-center gap-[4%] font-mono text-[0.42rem] text-paper/70">
            <span className="line-through decoration-seal-red">$68,500</span>
            <span className="font-bold text-brass">$0.03 · 14s</span>
          </div>
        </div>
      </div>

      {/* Bottom 3-market darkroom filmstrip */}
      <div className="grid flex-1 grid-cols-3 gap-[3.5%]">
        {FRAMES.map((frame, index) => (
          <div
            key={frame.city}
            style={cardAnim(index)}
            className="flex flex-col overflow-hidden border border-paper/35 bg-[#131d33]"
          >
            <div
              className="relative flex flex-1 items-center justify-center"
              style={{
                background: `radial-gradient(circle at 30% 25%, ${frame.accent}66, ${frame.bg} 78%)`,
              }}
            >
              <span className="h-[58%] w-[36%] rounded-t-[4px] border border-paper/70 bg-[#c26345] shadow-[0_3px_0_rgba(13,20,36,0.6)]" />
            </div>
            <div className="flex items-center justify-between border-paper/20 border-t px-[8%] py-[5%] font-mono text-[0.38rem]">
              <span className="font-bold text-brass">{frame.city}</span>
              <span className="text-paper/65">{frame.kelvin}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
