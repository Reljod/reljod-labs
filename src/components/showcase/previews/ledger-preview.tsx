import type { ReactNode } from "react";
import { experience } from "@/content/experience";
import { Cat } from "@/features/ledger/components/cat";

/** The jobs the preview's Build answers with: newest, then the bank years. */
const [newest, , , bank, financeData] = experience;
/** Matches the `haul` keyframes: the block lands halfway through the loop. */
const LANDS_AT = "2.8s";

/** Ledger mid-Build: he gallops a job off the About page onto the Build board, forever. */
export function LedgerPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[960/726] overflow-hidden bg-marble bg-[radial-gradient(rgb(20_33_61/0.12)_1px,transparent_1px)] bg-size-[14px_14px]"
    >
      <p className="eyebrow absolute top-[6%] left-[4%] text-[0.625rem] text-ink-muted">
        About page
      </p>
      <Slot top="14%">
        <JobBlock period={newest.period} company={newest.company} />
      </Slot>
      <Slot top="34%">
        <div className="h-full min-h-12 border-2 border-ink/40 border-dashed" />
      </Slot>
      <Slot top="54%">
        <JobBlock
          period={financeData.period}
          company={financeData.company}
          muted
        />
      </Slot>

      <div className="absolute top-[6%] left-[50%] h-[88%] w-[46%] border-2 border-ink border-dashed bg-paper/60" />
      <p className="eyebrow absolute top-[8%] left-[54%] text-[0.625rem] text-ink-muted">
        Build board
      </p>
      <p className="absolute top-[15%] right-[6%] max-w-[38%] rounded-sm bg-federal-blue px-2 py-1 text-[0.6875rem] leading-snug text-paper">
        Where has Reljod worked?
      </p>
      <Slot top="30%" left="54%">
        <JobBlock period={newest.period} company={newest.company} />
      </Slot>
      <Slot top="50%" left="54%" landing>
        <JobBlock period={bank.period} company={bank.company} highlight />
      </Slot>

      <div className="absolute z-10 w-[38%] -rotate-3 motion-safe:animate-haul motion-reduce:hidden">
        <JobBlock period={bank.period} company={bank.company} highlight />
        <div className="absolute top-full left-[8%] -mt-3 w-16 sm:w-28 [&_svg]:h-auto [&_svg]:w-full">
          <Cat pose="run" size={112} />
        </div>
      </div>
    </div>
  );
}

function Slot({
  top,
  left = "4%",
  landing,
  children,
}: {
  top: string;
  left?: string;
  /** Stamps in as Ledger drops the hauled block here. */
  landing?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`absolute w-[38%] ${landing ? "motion-safe:animate-find-box" : ""}`}
      style={{ top, left, animationDelay: landing ? LANDS_AT : undefined }}
    >
      {children}
    </div>
  );
}

function JobBlock({
  period,
  company,
  highlight,
  muted,
}: {
  period: string;
  company: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`outline-box px-2 py-1.5 shadow-hard-sm ${highlight ? "bg-morning-haze" : "bg-paper"} ${muted ? "opacity-60" : ""}`}
    >
      <p className="eyebrow truncate text-[0.5625rem] text-ink-muted">
        {period}
      </p>
      <p className="truncate text-[0.75rem] font-semibold">{company}</p>
    </div>
  );
}
