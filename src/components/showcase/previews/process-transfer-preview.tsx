import type { CSSProperties } from "react";

const LOOP_SECONDS = 7;

const STAGES = ["Watch", "Extract", "Verify", "Design", "Check"];

const STEPS = [
  { at: "0:12", text: "Open the remittance" },
  { at: "0:31", text: "Match it to the schedule" },
  { at: "0:58", text: "Investigate the variance" },
];

const lit = (delay: number): CSSProperties => ({
  animationName: "node-lit",
  animationDuration: `${LOOP_SECONDS}s`,
  animationDelay: `${delay - LOOP_SECONDS}s`,
  animationIterationCount: "infinite",
  animationTimingFunction: "linear",
});

/**
 * The demo in miniature: a recorded call on the left, the Stages lighting up
 * in turn, the steps it found, and a slide that gets its Approval stamp last.
 */
export function ProcessTransferPreview() {
  return (
    <div className="relative flex aspect-[960/726] flex-col gap-[3.5%] overflow-hidden bg-marble p-[5%]">
      <ol className="flex items-center gap-[2%]" aria-hidden="true">
        {STAGES.map((stage, index) => (
          <li
            key={stage}
            className="flex-1 rounded-sm border-2 border-ink bg-paper py-1 text-center font-mono text-[0.5rem] tracking-[0.06em] text-ink-muted uppercase"
            style={lit(index * 0.8 + 0.3)}
          >
            {stage}
          </li>
        ))}
      </ol>

      <div className="flex flex-1 gap-[4%]">
        <div className="outline-box flex flex-1 flex-col rounded-sm bg-ink p-[3%] shadow-hard-md">
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-seal-red motion-safe:animate-live-pulse" />
            <span className="font-mono text-[0.45rem] tracking-[0.08em] text-paper/80 uppercase">
              Rec · handover call
            </span>
          </div>
          <div
            className="mt-[5%] flex-1 space-y-1.5 rounded-sm bg-paper p-[6%]"
            aria-hidden="true"
          >
            <span className="block h-1.5 w-7/12 rounded-full bg-federal-blue" />
            <span className="block h-1.5 w-11/12 rounded-full bg-limestone" />
            <span className="block h-1.5 w-10/12 rounded-full bg-limestone" />
            <span className="block h-1.5 w-8/12 rounded-full bg-morning-haze" />
            <span className="block h-1.5 w-11/12 rounded-full bg-limestone" />
          </div>
          <div className="mt-[5%] flex gap-1.5" aria-hidden="true">
            <span className="flex size-5 items-center justify-center rounded-sm border-2 border-brass bg-paper font-mono text-[0.45rem] font-bold">
              AV
            </span>
            <span className="flex size-5 items-center justify-center rounded-sm bg-paper/30 font-mono text-[0.45rem] font-bold text-paper">
              JM
            </span>
          </div>
        </div>

        <div className="flex flex-[1.25] flex-col gap-[5%]">
          <div className="outline-box rounded-sm bg-paper p-[5%] shadow-hard-md">
            <p className="eyebrow text-[0.5rem] text-ink-muted">Steps</p>
            <ol className="mt-1 space-y-1">
              {STEPS.map((step, index) => (
                <li
                  key={step.at}
                  className="flex items-center gap-1.5 text-[0.55rem] leading-tight"
                >
                  <span className="font-mono font-bold text-federal-blue">
                    {index + 1}
                  </span>
                  <span className="flex-1">{step.text}</span>
                  <span className="font-mono text-[0.45rem] text-ink-muted">
                    {step.at}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="outline-box relative flex-1 rounded-sm bg-paper p-[5%] shadow-hard-md">
            <p className="eyebrow text-[0.5rem] text-ink-muted">
              Slide 4 · round 2
            </p>
            <p className="mt-1 text-[0.7rem] leading-tight font-bold">
              Investigate the variance
            </p>
            <div className="mt-1.5 space-y-1" aria-hidden="true">
              <span className="block h-1.5 w-9/12 rounded-full bg-limestone" />
              <span className="block h-1.5 w-7/12 rounded-full bg-limestone" />
            </div>
            <p className="mt-1.5 font-mono text-[0.45rem] text-ink-muted uppercase">
              Aligned · fits · 4 entrances
            </p>
            <span
              className="absolute right-[6%] bottom-[10%] rounded-sm border-[3px] border-ivy px-2 py-0.5 font-mono text-[0.65rem] font-bold tracking-[0.14em] text-ivy uppercase motion-safe:opacity-0"
              style={{
                animationName: "preview-stamp",
                animationDuration: `${LOOP_SECONDS}s`,
                animationIterationCount: "infinite",
                animationTimingFunction: "ease-out",
              }}
            >
              Approved
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
