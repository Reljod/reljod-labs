import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

const ink = (index: number): CSSProperties => ({
  animationDelay: `${0.35 + index * 0.32}s`,
  animationDuration: `${LOOP_SECONDS}s`,
});

/** One mark of the miniature screen: where it sits and what it is painted. */
const MARKS: { className: string; style: CSSProperties }[] = [
  {
    className: "bg-[#0b3c3d]",
    style: { left: "0%", top: "0%", width: "100%", height: "100%" },
  },
  {
    className: "rounded-full bg-[#ff7a4d]",
    style: { left: "7%", top: "8%", width: "6%", height: "8%" },
  },
  {
    className: "bg-[#f7f1e3]",
    style: { left: "15%", top: "10%", width: "22%", height: "4%" },
  },
  {
    className: "bg-[#f7f1e3]",
    style: { left: "7%", top: "28%", width: "46%", height: "9%" },
  },
  {
    className: "bg-[#ff7a4d]",
    style: { left: "7%", top: "40%", width: "34%", height: "9%" },
  },
  {
    className: "bg-[#cfe3dc]",
    style: { left: "7%", top: "54%", width: "40%", height: "3%" },
  },
  {
    className: "rounded-full bg-[#ff7a4d]",
    style: { left: "7%", top: "66%", width: "16%", height: "9%" },
  },
  {
    className: "rounded-full border-2 border-[#cfe3dc]",
    style: { left: "26%", top: "66%", width: "16%", height: "9%" },
  },
  {
    className: "rounded-[6px] bg-[#ff7a4d]",
    style: {
      left: "58%",
      top: "22%",
      width: "34%",
      height: "38%",
      rotate: "-6deg",
    },
  },
  {
    className: "rounded-[4px] bg-[#f2c230]",
    style: { left: "62%", top: "32%", width: "7%", height: "8%" },
  },
];

/** Vellum in miniature: a screen is drawn back mark by mark, then the Ruler stamps it. */
export function VellumPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[960/726] overflow-hidden bg-[#23463a] p-[6%]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(245,241,232,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(245,241,232,0.14) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="outline-box relative h-full w-full overflow-hidden bg-[#f8f6ee] shadow-hard-md">
        {/* The squared-up grid the Draftsman reads off. */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(rgba(192,0,128,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(192,0,128,0.35) 1px, transparent 1px)",
            backgroundSize: "10% 14%",
          }}
        />
        {MARKS.map((mark, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing.
            key={index}
            className={`absolute block motion-safe:animate-bloom ${mark.className}`}
            style={{ ...mark.style, ...ink(index) }}
          />
        ))}
        <div className="absolute inset-x-0 h-1 bg-brass/90 motion-safe:animate-scan-sweep" />
        <span
          className="absolute right-[5%] bottom-[7%] rounded-sm border-[3px] border-seal-red bg-paper/85 px-2 py-0.5 text-center font-mono text-[0.7rem] leading-tight font-bold text-seal-red motion-safe:opacity-0"
          style={{
            animationName: "preview-stamp",
            animationDuration: `${LOOP_SECONDS}s`,
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-out",
          }}
        >
          <span className="block text-[0.45rem] tracking-[0.2em]">
            LIKENESS
          </span>
          91%
        </span>
      </div>
    </div>
  );
}
