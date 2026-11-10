import type { CSSProperties } from "react";
import { Cat } from "@/features/ledger/components/cat";

const JOBS = [
  "Sort",
  "Read",
  "Identity",
  "The Act",
  "Payee",
  "Screen",
  "Decide",
];
const LOOP_SECONDS = 7;

/** A miniature desk: a request comes in, each job lights up in turn, the file is stamped. */
export function CaseworkPreview() {
  return (
    <div className="relative flex aspect-[960/726] flex-col gap-[4%] overflow-hidden bg-marble bg-[radial-gradient(rgb(20_33_61/0.1)_1px,transparent_1px)] bg-size-[14px_14px] p-[5%]">
      <p className="eyebrow text-[0.625rem] text-ink-muted">
        Pension withdrawal review
      </p>
      <ol className="flex items-center" aria-hidden="true">
        {JOBS.map((job, index) => (
          <li key={job} className="flex flex-1 flex-col items-center gap-1">
            <span
              className="size-6 rounded-sm border-2 border-ink bg-paper"
              style={
                {
                  animationDelay: `${index * 0.55 - LOOP_SECONDS}s`,
                  animationName: "node-lit",
                  animationDuration: `${LOOP_SECONDS}s`,
                  animationIterationCount: "infinite",
                  animationTimingFunction: "linear",
                } as CSSProperties
              }
            />
            <span className="font-mono text-[0.5rem] tracking-[0.06em] text-ink-muted uppercase">
              {job}
            </span>
          </li>
        ))}
      </ol>
      <div className="relative flex flex-1 gap-[4%]">
        <div className="outline-box relative flex-[1.3] rounded-sm bg-paper p-[4%] shadow-hard-md">
          <p className="eyebrow text-[0.5rem] text-ink-muted">Decision file</p>
          <p className="mt-1 font-mono text-[0.7rem] leading-tight font-bold uppercase">
            Approve: all 12 checks pass
          </p>
          <div className="mt-2 space-y-1.5" aria-hidden="true">
            <span className="block h-1.5 w-11/12 rounded-full bg-limestone" />
            <span className="block h-1.5 w-10/12 rounded-full bg-limestone" />
            <span className="block h-1.5 w-8/12 rounded-full bg-limestone" />
          </div>
          <span
            className="absolute right-[8%] bottom-[12%] rounded-sm border-[3px] border-ivy px-2 py-0.5 font-mono text-[0.75rem] font-bold tracking-[0.14em] text-ivy uppercase motion-safe:opacity-0"
            style={{
              animationName: "preview-stamp",
              animationDuration: `${LOOP_SECONDS}s`,
              animationIterationCount: "infinite",
              animationTimingFunction: "ease-out",
            }}
          >
            Approve
          </span>
        </div>
        <div className="outline-box flex flex-1 flex-col justify-end gap-1.5 rounded-sm bg-paper p-[4%] shadow-hard-md">
          <span className="self-end rounded-sm bg-federal-blue px-2 py-1 text-[0.5rem] text-paper">
            Review this withdrawal
          </span>
          <span className="self-start rounded-sm border border-ink/40 px-1.5 py-0.5 font-mono text-[0.45rem] uppercase">
            ⚙ pipeline · pension withdrawal
          </span>
          <span className="self-start rounded-sm bg-limestone px-2 py-1 text-[0.5rem]">
            Started. I'll ask if anything's missing.
          </span>
        </div>
        <div className="absolute -top-[18%] right-[30%]" aria-hidden="true">
          <Cat pose="conduct" size={64} />
        </div>
      </div>
    </div>
  );
}
