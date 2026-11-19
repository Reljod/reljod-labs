import { GROWTH_STEPS } from "../../domain/growth";
import type { GrowthStatus } from "../../domain/views";
import { cx } from "../ui";

/** What each step means, for the loop diagram at the top of the tab. */
const EXPLAIN: Record<string, string> = {
  requested: "Someone asks, in chat or here.",
  triaged:
    "Code de-duplicates and applies the Growth Rule; one model call classifies.",
  issue: "Filed on GitHub as a spec, the person's words quoted as untrusted.",
  pr: "A scheduled agent builds it inside the allowlist.",
  merged: "The PR pipeline reviews it; CI guards the paths.",
  live: "Deployed: the bank can now do it.",
};

/** End states that stop a request before Live, and the step they stop after. */
const ENDED_AFTER: Partial<Record<GrowthStatus, number>> = {
  refused: 1,
  duplicate: 1,
  closed: 2,
};

const END_LABEL: Partial<Record<GrowthStatus, string>> = {
  refused: "Refused",
  duplicate: "Duplicate",
  closed: "Closed",
};

/** The loop, once, as a row of six numbered steps with what each one is. */
export function GrowthLoop() {
  return (
    <ol
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      aria-label="How the bank grows itself"
    >
      {GROWTH_STEPS.map((step, index) => (
        <li
          key={step.status}
          className="outline-box relative rounded-sm bg-paper p-2.5 shadow-hard-sm"
        >
          <p className="flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded-sm bg-ink font-mono text-[0.65rem] font-bold text-paper">
              {index + 1}
            </span>
            <span className="font-mono text-xs font-bold tracking-[0.04em] uppercase">
              {step.label}
            </span>
          </p>
          <p className="mt-1.5 text-xs leading-snug text-ink-muted">
            {EXPLAIN[step.status]}
          </p>
          {index < GROWTH_STEPS.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 -right-2.5 z-10 hidden -translate-y-1/2 font-mono text-sm font-bold lg:block"
            >
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Where one request stands: completed steps filled, the current one
 * breathing, the rest empty. A request that stopped (refused, a duplicate,
 * closed) shows where it stopped and an end stamp.
 */
export function GrowthTracker({ status }: { status: GrowthStatus }) {
  const endedAfter = ENDED_AFTER[status];
  const at =
    endedAfter ?? GROWTH_STEPS.findIndex((step) => step.status === status);
  const live = status === "live";
  return (
    <div
      className="flex flex-wrap items-center gap-y-2"
      data-testid="bank-growth-tracker"
    >
      <ol
        className="flex min-w-0 items-center"
        aria-label={`Stands at: ${END_LABEL[status] ?? GROWTH_STEPS[at]?.label ?? status}`}
      >
        {GROWTH_STEPS.map((step, index) => {
          const done =
            index < at || (index === at && (live || endedAfter !== undefined));
          const current = index === at && !live && endedAfter === undefined;
          return (
            <li
              key={step.status}
              title={step.label}
              aria-current={current ? "step" : undefined}
              className="flex shrink-0 items-center"
            >
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={cx(
                    "h-0.5 w-3 sm:w-5",
                    index <= at ? "bg-ink" : "bg-ink/20",
                  )}
                />
              ) : null}
              <span
                className={cx(
                  "flex h-6 items-center rounded-sm border-2 px-1.5 font-mono text-[0.6rem] font-bold tracking-[0.04em] uppercase",
                  done && "border-ink bg-ink text-paper",
                  current &&
                    "tb-step-live border-federal-blue bg-morning-haze text-federal-blue",
                  !done && !current && "border-ink/25 bg-paper text-ink/40",
                )}
              >
                <span className="hidden sm:inline">{step.label}</span>
                <span className="sm:hidden">{index + 1}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {endedAfter !== undefined ? (
        <span className="ml-2 rounded-sm border-2 border-seal-red px-1.5 font-mono text-[0.65rem] font-bold tracking-[0.1em] text-seal-red uppercase -rotate-3">
          {END_LABEL[status]}
        </span>
      ) : null}
    </div>
  );
}
