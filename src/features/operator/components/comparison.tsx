"use client";

import type { Verdict } from "../domain/checks";
import type { RunSummary } from "../domain/contract";
import { VerdictTag } from "./checklist";
import { timesSlower } from "./compare";
import { duration, errorsLabel, modelLabel } from "./format";
import { cx, Panel } from "./ui";

function Side({
  title,
  note,
  ms,
  errors,
  verdict,
  strong = false,
}: {
  title: string;
  note: string;
  ms: number;
  errors: number;
  verdict: Verdict | null;
  strong?: boolean;
}) {
  return (
    <div
      className={cx(
        "outline-box flex flex-col gap-2 rounded-sm p-3",
        strong ? "bg-morning-haze" : "bg-paper",
      )}
    >
      <div>
        <p className="eyebrow text-[0.65rem]">{title}</p>
        <p className="text-xs text-ink-muted">{note}</p>
      </div>
      <p className="font-mono text-2xl font-bold tabular-nums">
        {ms > 0 ? duration(ms) : "no time"}
      </p>
      <p className="text-sm">
        {errorsLabel(errors)}{" "}
        <span className="text-ink-muted">from HARBOURMASTER</span>
      </p>
      <p>
        <VerdictTag verdict={verdict} />
      </p>
    </div>
  );
}

/** A Run by hand next to the Operator's Run of the same Task: time, errors, Verdict. */
export function Comparison({
  hand,
  operator,
}: {
  hand: Pick<RunSummary, "metrics" | "verdict">;
  operator: RunSummary | null;
}) {
  const ratio = operator
    ? timesSlower(hand.metrics.ms, operator.metrics.ms)
    : null;
  return (
    <Panel eyebrow="Same Task, same checks" title="You and the Operator">
      <div className="grid gap-3 sm:grid-cols-2">
        <Side
          title="You"
          note="By hand, in your browser"
          ms={hand.metrics.ms}
          errors={hand.metrics.errors}
          verdict={hand.verdict}
          strong
        />
        {operator ? (
          <Side
            title="The Operator"
            note={
              operator.replay
                ? `The recorded Run, on ${modelLabel(operator.model)}`
                : `Your latest Run, on ${modelLabel(operator.model)}`
            }
            ms={operator.metrics.ms}
            errors={operator.metrics.errors}
            verdict={operator.verdict}
          />
        ) : (
          <div className="grid place-items-center rounded-sm border-2 border-ink/25 border-dashed p-3 text-center text-sm text-ink-muted">
            No Operator Run of this Task to compare with yet. Pick the Task
            above and let the Operator do it.
          </div>
        )}
      </div>
      {ratio && operator ? (
        <p className="mt-3 text-sm">
          {ratio === 1
            ? "You took about the same time."
            : hand.metrics.ms > operator.metrics.ms
              ? `The Operator was ${ratio} times as fast.`
              : `You were ${ratio} times as fast.`}{" "}
          <span className="text-ink-muted">
            Both were checked by the same code against the same Books.
          </span>
        </p>
      ) : null}
    </Panel>
  );
}
