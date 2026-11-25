import type { CSSProperties } from "react";

const LOOP_SECONDS = 5.6;

const at = (delay: number): CSSProperties => ({
  animationDelay: `${delay}s`,
  animationDuration: `${LOOP_SECONDS}s`,
});

/** Floorwalk in miniature: a body-camera frame down an aisle, problems boxed as they are found, pins on the plan. */
export function FloorwalkPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative grid aspect-[960/726] grid-cols-[1.6fr_1fr] gap-[4%] overflow-hidden bg-marble p-[5%]"
    >
      <div className="outline-box relative overflow-hidden bg-[#3a4048] shadow-hard-md">
        {/* An aisle in perspective: racks either side, a fire exit at the end. */}
        <svg
          viewBox="0 0 160 120"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
        >
          <polygon points="0,0 62,40 62,78 0,120" fill="#2f5d9e" />
          <polygon points="160,0 98,40 98,78 160,120" fill="#2f5d9e" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line
                x1={0}
                y1={18 + i * 26}
                x2={62}
                y2={46 + i * 8}
                stroke="#e8771e"
                strokeWidth="2"
              />
              <line
                x1={160}
                y1={18 + i * 26}
                x2={98}
                y2={46 + i * 8}
                stroke="#e8771e"
                strokeWidth="2"
              />
            </g>
          ))}
          <polygon points="62,78 98,78 160,120 0,120" fill="#8f9396" />
          <rect x="62" y="40" width="36" height="38" fill="#c9cfd3" />
          <rect x="74" y="52" width="12" height="26" fill="#1d7a46" />
          <rect x="72" y="47" width="16" height="4" fill="#0f6b3a" />
          <rect x="73" y="62" width="14" height="16" fill="#b8915e" />
          <ellipse cx="70" cy="100" rx="16" ry="5" fill="#3d4a52" />
        </svg>
        <div
          className="absolute inset-x-0 h-0.5 bg-brass shadow-[0_0_14px_4px_rgb(217_168_78/0.65)] motion-safe:animate-scan-sweep motion-reduce:hidden"
          style={at(0)}
        />
        <div
          className="absolute top-[38%] left-[43%] h-[28%] w-[16%] border-[3px] border-seal-red motion-safe:animate-find-box"
          style={at(1.1)}
        >
          <span className="absolute -top-[1.1em] left-0 bg-seal-red px-[3px] font-mono text-[0.4rem] font-bold whitespace-nowrap text-paper uppercase">
            Exit blocked
          </span>
        </div>
        <div
          className="absolute top-[76%] left-[30%] h-[14%] w-[24%] border-[3px] border-brass motion-safe:animate-find-box"
          style={at(1.9)}
        >
          <span className="absolute top-full left-0 bg-brass px-[3px] font-mono text-[0.4rem] font-bold whitespace-nowrap text-ink uppercase">
            Spill, no sign
          </span>
        </div>
        <span className="absolute top-[4%] left-[4%] flex items-center gap-1 font-mono text-[0.4rem] font-bold text-paper">
          <span className="size-1.5 rounded-full bg-seal-red" /> BODYCAM 02
        </span>
      </div>
      <div className="flex flex-col gap-[6%]">
        <div className="outline-box relative flex-1 bg-paper shadow-hard-sm">
          <svg
            viewBox="0 0 60 80"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {[10, 26, 42].map((x) => (
              <rect
                key={x}
                x={x}
                y="12"
                width="6"
                height="52"
                fill="none"
                stroke="#14213d"
                strokeWidth="1"
              />
            ))}
            <path
              d="M22,74 L22,6 L50,6 L50,70"
              fill="none"
              stroke="#1d4e89"
              strokeWidth="2.5"
              pathLength={1}
              strokeDasharray="1"
              className="motion-safe:animate-walk"
              style={at(0)}
            />
            <circle
              cx="22"
              cy="10"
              r="3.4"
              fill="#b23a2b"
              stroke="#14213d"
              className="motion-safe:animate-bloom"
              style={at(1.2)}
            />
            <circle
              cx="22"
              cy="44"
              r="3.4"
              fill="#d9a84e"
              stroke="#14213d"
              className="motion-safe:animate-bloom"
              style={at(1.9)}
            />
            <circle
              cx="50"
              cy="40"
              r="3.4"
              fill="#d9a84e"
              stroke="#14213d"
              className="motion-safe:animate-bloom"
              style={at(2.6)}
            />
          </svg>
        </div>
        <div
          className="outline-box bg-paper px-[8%] py-[6%] shadow-hard-sm motion-safe:animate-bloom"
          style={at(3.1)}
        >
          <p className="font-mono text-[0.4rem] tracking-[0.08em] text-ink-muted uppercase">
            Score
          </p>
          <p className="font-mono text-base leading-none font-black">31</p>
          <p className="mt-[4%] -rotate-6 border-2 border-seal-red px-[3px] text-center font-mono text-[0.4rem] font-black text-seal-red uppercase">
            Stop and fix
          </p>
        </div>
      </div>
    </div>
  );
}
