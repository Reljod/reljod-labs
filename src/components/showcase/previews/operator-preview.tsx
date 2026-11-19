import type { CSSProperties } from "react";

const LOOP_SECONDS = 7;

/** Customs holds being released, one container a line (valid ISO 6346 check digits). */
const LINES = [
  { container: "MRDU4821131", reason: "23" },
  { container: "TGHU3317207", reason: "41" },
  { container: "MSKU9070323", reason: "23" },
];

/*
 * Keyframes for this preview only, hoisted and de-duplicated by React
 * (`href` + `precedence`). Transforms and opacity only; the catalog pauses
 * them until the card is looked at.
 */
const KEYFRAMES = `
@keyframes op-fill-0 { 0%, 10% { opacity: 0 } 14%, 92% { opacity: 1 } 100% { opacity: 0 } }
@keyframes op-fill-1 { 0%, 22% { opacity: 0 } 26%, 92% { opacity: 1 } 100% { opacity: 0 } }
@keyframes op-fill-2 { 0%, 34% { opacity: 0 } 38%, 92% { opacity: 1 } 100% { opacity: 0 } }
@keyframes op-caret {
  0%, 12% { transform: translateY(0) }
  13%, 24% { transform: translateY(100%) }
  25%, 36% { transform: translateY(200%) }
  37%, 100% { transform: translateY(300%); opacity: 0 }
}
@keyframes op-glide {
  0%, 40% { transform: translate(0, 0); opacity: 0 }
  44% { transform: translate(0, 0); opacity: 1 }
  58%, 92% { transform: translate(-1%, 40%); opacity: 1 }
  100% { transform: translate(-1%, 40%); opacity: 0 }
}
@keyframes op-press {
  0%, 58% { transform: translate(0, 0) }
  61% { transform: translate(2px, 2px) }
  64%, 100% { transform: translate(0, 0) }
}
@keyframes op-stamp {
  0%, 64% { opacity: 0; transform: scale(2.2) rotate(-14deg) }
  70%, 94% { opacity: 1; transform: scale(1) rotate(-8deg) }
  100% { opacity: 0; transform: scale(1) rotate(-8deg) }
}
`;

const play = (name: string, timing = "linear"): CSSProperties => ({
  animationName: name,
  animationDuration: `${LOOP_SECONDS}s`,
  animationIterationCount: "infinite",
  animationTimingFunction: timing,
});

const GREEN = "text-[#7cfc9a]";

/**
 * Operator in miniature: a HARBOURMASTER green screen in a Colonnade bezel.
 * Container numbers key in line by line, the pointer glides to F10, and the
 * Guard stamps the release "Needs a person".
 */
export function OperatorPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative flex aspect-[960/726] flex-col gap-[3%] overflow-hidden bg-marble p-[5%]"
    >
      <style href="operator-preview-keyframes" precedence="default">
        {KEYFRAMES}
      </style>

      <div className="outline-box flex flex-1 flex-col gap-[3%] rounded-sm bg-paper p-[3%] shadow-hard-md">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-[0.5rem] font-bold">HARBOURMASTER</span>
          <span className="rounded-sm bg-ink px-1 py-px font-mono text-[0.45rem] font-bold text-paper">
            HMH400
          </span>
        </div>

        <div
          className={`relative flex flex-1 flex-col gap-[3%] rounded-sm border-2 border-ink bg-[#0d1f14] p-[3%] font-mono text-[0.5rem] leading-tight ${GREEN}`}
        >
          <p className="font-bold">HMH400 CUSTOMS HOLDS</p>
          <p className="opacity-70">VOYAGE 0412N ACTION R=RELEASE</p>
          <div className="relative mt-[2%] flex flex-col">
            {LINES.map((line, index) => (
              <p key={line.container} className="flex gap-[4%]">
                <span className="opacity-70">CNTR NO</span>
                <span className="relative min-w-[11ch]">
                  <span className="absolute inset-x-0 bottom-0 border-[#7cfc9a]/40 border-b" />
                  <span style={play(`op-fill-${index}`, "steps(1, end)")}>
                    {line.container}
                  </span>
                </span>
                <span className="opacity-70">RSN</span>
                <span style={play(`op-fill-${index}`, "steps(1, end)")}>
                  {line.reason}
                </span>
                <span style={play(`op-fill-${index}`, "steps(1, end)")}>R</span>
              </p>
            ))}
            {/* The text cursor, stepping down a line as each one is keyed. */}
            <span
              className="absolute top-0 left-[30%] h-[calc(100%/3)] w-[0.5ch] bg-[#7cfc9a]"
              style={play("op-caret", "steps(1, end)")}
            />
          </div>
          <p className="mt-auto opacity-70">F3=EXIT F10=COMMIT F12=CANCEL</p>
        </div>

        <div className="flex justify-end gap-[2%]">
          {["F3", "F10", "F12"].map((key) => (
            <span
              key={key}
              className="outline-box rounded-sm bg-paper px-[3%] py-[1%] font-mono text-[0.5rem] font-bold shadow-hard-sm"
              style={key === "F10" ? play("op-press") : undefined}
            >
              {key}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-[2%]">
        <span className="rounded-sm border-2 border-ink bg-morning-haze px-1.5 py-0.5 font-mono text-[0.45rem] font-bold uppercase">
          Guard
        </span>
        <span className="font-mono text-[0.45rem] text-ink-muted">
          hold.release · waits for a person
        </span>
      </div>

      {/* The pointer glides from the screen to F10. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={play("op-glide", "cubic-bezier(0.45, 0.05, 0.25, 1)")}
      >
        <svg
          viewBox="0 0 12 18"
          className="absolute top-[38%] left-[84%] w-[3.2%]"
          role="presentation"
        >
          <path
            d="M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L12 10 Z"
            fill="var(--color-paper)"
            stroke="var(--color-ink)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <span
        className="absolute right-[8%] bottom-[16%] rounded-sm border-[3px] border-oak bg-paper/90 px-2 py-0.5 font-mono text-[0.6rem] font-bold tracking-[0.12em] text-oak uppercase"
        style={play("op-stamp", "ease-out")}
      >
        Needs a person
      </span>
    </div>
  );
}
