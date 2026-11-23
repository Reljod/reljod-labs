import type { CSSProperties } from "react";

const SQRT3 = Math.sqrt(3);
const SIZE = 9;

/** Radius-2 hex field: the company in the middle, the rim burning in turn. */
const HEXES = (() => {
  const cells: { x: number; y: number; ring: number; index: number }[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const ring = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
      if (ring > 2) continue;
      cells.push({
        x: SIZE * SQRT3 * (q + r / 2),
        y: SIZE * 1.5 * r,
        ring,
        index: cells.length,
      });
    }
  }
  return cells;
})();

const POINTS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${((SIZE - 0.8) * Math.cos(a)).toFixed(2)},${((SIZE - 0.8) * Math.sin(a)).toFixed(2)}`;
}).join(" ");

const burn = (index: number, ring: number): CSSProperties => ({
  animationDelay: `${(ring === 2 ? 0 : 0.9) + (index % 6) * 0.22}s`,
});

/** Firebreak in miniature: the map catches from the rim, a card lands, a Rule is stamped. */
export function FirebreakPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] gap-[4%] overflow-hidden bg-ink p-[5%]"
    >
      <svg
        viewBox="-42 -38 84 76"
        className="h-full w-[58%]"
        aria-hidden="true"
      >
        {HEXES.map((hex) => (
          <polygon
            key={hex.index}
            points={POINTS}
            transform={`translate(${hex.x} ${hex.y})`}
            fill={hex.ring === 0 ? "#ffffff" : "#f5f1e8"}
            stroke="#14213d"
            strokeWidth="1"
            className={hex.ring === 0 ? "" : "motion-safe:animate-burn"}
            style={hex.ring === 0 ? undefined : burn(hex.index, hex.ring)}
          />
        ))}
        <text
          textAnchor="middle"
          dy="2.6"
          fontSize="7"
          fontWeight="700"
          fill="#14213d"
          className="font-mono"
        >
          HA
        </text>
      </svg>
      <div className="flex flex-1 flex-col justify-center gap-[8%]">
        <p className="outline-box bg-paper px-[6%] py-[5%] font-mono text-[0.5rem] leading-tight font-bold shadow-hard-sm">
          <span className="text-seal-red">T+8h</span> The pilots draw a line
        </p>
        <p
          className="outline-box -rotate-6 self-start bg-ivy px-[6%] py-[3%] font-mono text-[0.5rem] font-bold text-paper shadow-hard-sm motion-safe:animate-bloom"
          style={{ animationDelay: "1.6s" }}
        >
          MET · report in 24h
        </p>
        <p
          className="outline-box rotate-3 self-end bg-seal-red px-[6%] py-[3%] font-mono text-[0.5rem] font-bold text-paper shadow-hard-sm motion-safe:animate-bloom"
          style={{ animationDelay: "2.6s" }}
        >
          MISSED · tell them in 6h
        </p>
      </div>
    </div>
  );
}
