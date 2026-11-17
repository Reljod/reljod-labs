import type { CSSProperties } from "react";

const LOOP_SECONDS = 7;

/** A Pipeline in miniature: Steps in the order they can run; a level runs at the same time. */
const LEVELS = [["Load"], ["Identity", "Eligibility"], ["Amount"], ["Draft"]];

const TABS = ["Chat", "Pipelines", "Knowledge", "Skills", "Audit"];

const lit = (delay: number): CSSProperties => ({
  animationName: "node-lit",
  animationDuration: `${LOOP_SECONDS}s`,
  animationDelay: `${delay - LOOP_SECONDS}s`,
  animationIterationCount: "infinite",
  animationTimingFunction: "linear",
});

/**
 * The Harness in miniature: a Staff member asks, the Agent starts a
 * Pipeline, its Steps light up level by level, and the Run stops for a
 * person's Approval.
 */
export function HarnessPreview() {
  return (
    <div className="relative flex aspect-[960/726] flex-col overflow-hidden bg-marble">
      {/* The shared demo bar, small: number, tabs as stamped boxes, the Role. */}
      <div className="flex items-center gap-[2%] border-ink border-b-2 bg-marble px-[4%] py-[2.5%]">
        <span className="rounded-sm bg-ink px-1 py-px font-mono text-[0.45rem] font-bold text-paper">
          01
        </span>
        {TABS.map((tab, index) => (
          <span
            key={tab}
            className={`rounded-sm border border-ink px-1.5 py-0.5 font-mono text-[0.45rem] font-bold tracking-[0.06em] uppercase shadow-[1px_1px_0_var(--color-ink)] ${index === 1 ? "bg-ink text-paper" : "bg-paper text-ink"}`}
          >
            {tab}
          </span>
        ))}
        <span className="ml-auto rounded-sm border border-ink bg-ink px-1.5 py-0.5 font-mono text-[0.45rem] font-bold tracking-[0.06em] text-paper uppercase">
          Admin
        </span>
      </div>

      <div className="flex flex-1 gap-[3%] p-[4%]">
        <div className="outline-box flex flex-1 flex-col justify-end gap-1.5 rounded-sm bg-paper p-[4%] shadow-hard-md">
          <span className="self-end rounded-sm bg-federal-blue px-2 py-1 text-[0.5rem] text-paper">
            Process this transfer request
          </span>
          <span className="self-start rounded-sm border border-ink/40 px-1.5 py-0.5 font-mono text-[0.45rem] uppercase">
            ⚙ skill · member-request
          </span>
          <span className="self-start rounded-sm bg-limestone px-2 py-1 text-[0.5rem]">
            Run started. One Rule needs a person.
          </span>
          <span className="self-start rounded-sm border-2 border-ink bg-morning-haze px-2 py-1 font-mono text-[0.45rem] font-bold uppercase">
            View pipeline →
          </span>
        </div>

        <div className="outline-box relative flex flex-[1.5] flex-col rounded-sm bg-paper p-[4%] shadow-hard-md">
          <p className="eyebrow text-[0.5rem] text-ink-muted">
            Pipeline · member_request
          </p>
          <ol
            className="mt-[6%] flex flex-1 items-center justify-between"
            aria-hidden="true"
          >
            {LEVELS.map((level, levelIndex) => (
              <li
                key={level.join("-")}
                className="flex flex-col items-center gap-2"
              >
                {level.map((step) => (
                  <span
                    key={step}
                    className="rounded-sm border-2 border-ink bg-paper px-1.5 py-1 font-mono text-[0.45rem] tracking-[0.04em] text-ink-muted uppercase"
                    style={lit(levelIndex * 0.9 + 0.4)}
                  >
                    {step}
                  </span>
                ))}
              </li>
            ))}
          </ol>
          <div className="mt-[4%] flex items-center justify-between gap-2 border-ink/20 border-t pt-[4%]">
            <p className="font-mono text-[0.5rem] leading-tight">
              <span className="font-bold text-oak">REFER</span>
              <span className="text-ink-muted"> · notice period · rule v3</span>
            </p>
            <span
              className="rounded-sm border-[3px] border-ivy px-2 py-0.5 font-mono text-[0.6rem] font-bold tracking-[0.14em] text-ivy uppercase motion-safe:opacity-0"
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
