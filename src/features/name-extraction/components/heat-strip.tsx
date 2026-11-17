"use client";

import { type KeyboardEvent, type PointerEvent, useRef } from "react";

export type Tick = { page: number; tone: "missed" | "extra" };

const TICK_COLOR = { missed: "#b23a2b", extra: "#d9a84e" } as const;

/**
 * The whole Document as a thin strip beside the reader: darker where a page
 * has more names, red and amber ticks where names were missed or extra, a
 * window for what is on screen. Click, drag or use the arrow keys to move.
 */
export function HeatStrip({
  total,
  density,
  ticks = [],
  first,
  last,
  onJump,
  label = "Names per page",
}: {
  total: number;
  density: ArrayLike<number> | null;
  ticks?: Tick[];
  first: number;
  last: number;
  onJump: (page: number) => void;
  label?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  let peak = 1;
  if (density)
    for (let i = 0; i < density.length; i++) peak = Math.max(peak, density[i]);

  const pageAt = (clientY: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box) return first;
    const share = Math.min(1, Math.max(0, (clientY - box.top) / box.height));
    return Math.min(total, Math.max(1, Math.ceil(share * total)));
  };
  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointerdown")
      event.currentTarget.setPointerCapture(event.pointerId);
    else if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onJump(pageAt(event.clientY));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: 10,
      PageUp: -10,
    };
    if (event.key === "Home") onJump(1);
    else if (event.key === "End") onJump(total);
    else if (by[event.key])
      onJump(Math.min(total, Math.max(1, first + by[event.key])));
    else return;
    event.preventDefault();
  };

  const bars = [];
  if (density)
    for (let index = 0; index < total; index++) {
      const value = density[index] ?? 0;
      if (value > 0)
        bars.push(
          <rect
            key={index}
            x={0}
            y={index}
            width={10}
            height={1}
            fill="#1d4e89"
            opacity={0.18 + 0.82 * (value / peak)}
          />,
        );
    }
  const tickHeight = Math.max(1, total / 160);

  return (
    <div
      ref={strip}
      role="slider"
      tabIndex={0}
      aria-label={`${label}: jump to a page`}
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={first}
      aria-valuetext={`Page ${first} of ${total}`}
      onPointerDown={onPointer}
      onPointerMove={onPointer}
      onKeyDown={onKey}
      className="relative w-3.5 shrink-0 cursor-pointer touch-none rounded-full bg-ink/[0.06] ring-1 ring-ink/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue sm:w-5"
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 10 ${total}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-hidden rounded-full"
      >
        {bars}
        {ticks.map((tick, index) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: ticks may repeat a page; order is stable
            key={index}
            x={tick.tone === "missed" ? 0 : 6}
            y={tick.page - 1}
            width={tick.tone === "missed" ? 10 : 4}
            height={tickHeight}
            fill={TICK_COLOR[tick.tone]}
          />
        ))}
      </svg>
      <span
        aria-hidden="true"
        className="absolute -inset-x-1 rounded-sm border-2 border-ink bg-paper/30 transition-[top,height] duration-150"
        style={{
          top: `${((first - 1) / total) * 100}%`,
          height: `max(6px, ${((last - first + 1) / total) * 100}%)`,
        }}
      />
    </div>
  );
}
