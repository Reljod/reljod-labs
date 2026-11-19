import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

/** Daily peak load across a fortnight; the heatwave days stand out. */
const BARS = [38, 42, 40, 46, 44, 78, 88, 94, 90, 82, 48, 43, 41, 45];

const bloom = (index: number): CSSProperties => ({
  animationDelay: `${0.3 + index * 0.18}s`,
  animationDuration: `${LOOP_SECONDS}s`,
});

/** Canvas in miniature: a question goes in, a checked chart with a control comes back. */
export function CanvasPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] flex-col gap-[4%] overflow-hidden bg-marble p-[5%]"
    >
      <p className="outline-box w-fit max-w-[80%] bg-paper px-[3%] py-[1.5%] text-[0.55rem] font-semibold shadow-hard-sm">
        What did the February heatwave do to peak load?
      </p>
      <div className="outline-box flex flex-1 flex-col bg-paper shadow-hard-md">
        <div className="flex items-center justify-between border-ink border-b-2 px-[4%] py-[2%]">
          <span className="font-mono text-[0.45rem] font-bold tracking-[0.08em] uppercase">
            Bar · 14 rows
          </span>
          <span
            className="border-2 border-ivy px-[2%] font-mono text-[0.45rem] font-bold tracking-[0.08em] text-ivy uppercase motion-safe:animate-bloom"
            style={bloom(BARS.length + 2)}
          >
            ✓ Verified
          </span>
        </div>
        <div className="flex flex-1 items-end gap-[2%] px-[5%] pt-[4%]">
          {BARS.map((height, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: decorative bars.
              key={index}
              className={`flex-1 origin-bottom rounded-t-[2px] motion-safe:animate-bloom ${height > 70 ? "bg-brass" : "bg-federal-blue"}`}
              style={{ height: `${height}%`, ...bloom(index) }}
            />
          ))}
        </div>
        <div className="flex items-center gap-[3%] border-ink/30 border-t px-[5%] py-[3%]">
          <span className="font-mono text-[0.45rem] text-ink-muted uppercase">
            Peak at least
          </span>
          <span className="relative h-0.5 flex-1 bg-ink/30">
            <span className="absolute top-1/2 left-[62%] size-2 -translate-y-1/2 border-2 border-ink bg-paper" />
          </span>
          <span className="font-mono text-[0.45rem] font-bold">2,400 MW</span>
        </div>
      </div>
    </div>
  );
}
