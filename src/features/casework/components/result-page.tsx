"use client";

import { CHECKS } from "../domain/checks";
import { formatMoney } from "../domain/dates";
import { kindLabel } from "../domain/document-kinds";
import { JOBS } from "../domain/jobs";
import type { DocView } from "../view";
import type { RunCard } from "./chat-panel";
import { JobGlyph, OUTCOME_STYLE, RECOMMENDATION_STYLE } from "./glyphs";
import type { JobState, RunView } from "./run-reducer";
import { OwnershipView } from "./stage";

const DISPOSITION = {
  false_positive: { label: "Not the same person", tone: "text-ivy" },
  true_match: { label: "True match", tone: "text-seal-red" },
  inconclusive: { label: "Could not tell", tone: "text-oak" },
} as const;

const STEP_STATE: Record<JobState, { label: string; tone: string }> = {
  pending: { label: "Not reached", tone: "text-stone" },
  running: { label: "Running", tone: "text-federal-blue" },
  waiting: { label: "Waiting", tone: "text-oak" },
  done: { label: "Done", tone: "text-ivy" },
  skipped: { label: "Skipped", tone: "text-stone" },
  error: { label: "Failed", tone: "text-seal-red" },
  stopped: { label: "Stopped here", tone: "text-seal-red" },
};

function seconds(value: number) {
  const whole = Math.round(value);
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-mono text-[11px] font-bold tracking-[0.12em] text-ink-muted uppercase">
      {children}
    </h3>
  );
}

/**
 * How a Run ended, on one page: the recommendation and why, what to do next,
 * then every step in order with what it is for and what it found, and the
 * Documents it read.
 */
export function ResultPage({
  run,
  docs,
  onOpenDoc,
  cost,
}: {
  run: RunView;
  docs: Map<string, DocView>;
  onOpenDoc: (id: string) => void;
  cost?: RunCard;
}) {
  const decision = run.decision;
  const style = decision ? RECOMMENDATION_STYLE[decision.recommendation] : null;
  const count = (outcome: "pass" | "fail" | "review") =>
    run.checks.filter((check) => check.outcome === outcome).length;
  const elapsed =
    run.startedAt && run.lastAt ? (run.lastAt - run.startedAt) / 1000 : 0;
  const hitsJob = run.jobs.some((item) => item.job === "adjudicate")
    ? "adjudicate"
    : "screen";

  return (
    <div className="cw-scroll cw-reveal h-full min-h-0 overflow-y-auto pr-1">
      {/* The answer */}
      <section className="rounded-sm border-2 border-ink bg-paper p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64">
            <p className="font-mono text-[11px] font-bold tracking-[0.12em] text-ink-muted uppercase">
              Result
            </p>
            <h3 className="mt-1 text-xl leading-snug font-semibold text-balance">
              {decision
                ? decision.headline
                : run.status === "stopped"
                  ? "Stopped before a decision"
                  : run.status === "failed"
                    ? "The run failed before a decision"
                    : "Finished without a decision"}
            </h3>
          </div>
          <span
            className={`shrink-0 rounded-sm border-4 px-3 py-1 font-mono text-lg font-bold tracking-[0.12em] uppercase ${style ? style.tone : "border-seal-red text-seal-red"}`}
          >
            {style ? style.stamp : run.status}
          </span>
        </div>
        {decision ? (
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed">
            {decision.summary}
          </p>
        ) : (
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-ink-muted">
            {run.error ??
              "Below is everything the steps found before it ended. Start the review again from the chat to finish it."}
          </p>
        )}
        <dl className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
          {(["pass", "review", "fail"] as const).map((outcome) => (
            <div
              key={outcome}
              className={`rounded-sm px-2 py-1 font-bold ${OUTCOME_STYLE[outcome].tone}`}
            >
              {count(outcome)} {OUTCOME_STYLE[outcome].label.toLowerCase()}
            </div>
          ))}
          {run.risk ? (
            <div className="rounded-sm border border-ink/40 px-2 py-1">
              {run.risk.rating} risk
            </div>
          ) : null}
          {cost ? (
            <div
              className="rounded-sm border border-ink/40 px-2 py-1"
              title="What this run's model calls cost"
            >
              Cost <span className="font-bold">${cost.costUsd.toFixed(4)}</span>{" "}
              · {cost.calls} model call{cost.calls === 1 ? "" : "s"}
            </div>
          ) : null}
          {elapsed > 0 ? (
            <div className="rounded-sm border border-ink/40 px-2 py-1">
              {seconds(elapsed)}
            </div>
          ) : null}
        </dl>
      </section>

      {decision && decision.nextSteps.length > 0 ? (
        <section className="mt-5">
          <SectionTitle>What to do next</SectionTitle>
          <ol className="grid gap-1.5">
            {decision.nextSteps.map((step, index) => (
              <li
                key={step}
                className="flex gap-2.5 rounded-sm border border-ink/25 bg-paper px-3 py-2 text-sm"
              >
                <span className="font-mono font-bold text-federal-blue">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* How it got there */}
      <section className="mt-5">
        <SectionTitle>How it got there, step by step</SectionTitle>
        <ol className="grid gap-2">
          {run.jobs.map((item, index) => {
            const spec = JOBS[item.job];
            const checks = run.checks.filter((check) => check.job === item.job);
            const state = STEP_STATE[item.state];
            return (
              <li
                key={`${index}-${item.job}`}
                className={`rounded-sm border bg-paper p-3 ${item.state === "pending" ? "border-ink/15 opacity-60" : "border-ink/30"}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-sm border-2 border-ink ${spec.model ? "bg-federal-blue text-paper" : "bg-limestone"}`}
                    title={spec.model ? "Calls a model" : "Rules, no model"}
                  >
                    <JobGlyph job={item.job} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="font-mono text-xs font-bold tracking-[0.06em] uppercase">
                        {index + 1}. {spec.title}
                      </p>
                      <span
                        className={`font-mono text-[10px] font-bold tracking-[0.06em] uppercase ${state.tone}`}
                      >
                        {state.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-muted">
                      {spec.plain}
                    </p>
                    {item.summary && item.job !== "decide" ? (
                      <p className="mt-1.5 text-[13px]">
                        <span className="font-semibold">Found: </span>
                        {item.summary}
                      </p>
                    ) : null}
                  </div>
                </div>

                {checks.length > 0 ? (
                  <ul className="mt-2.5 grid gap-1 border-ink/10 border-t pt-2.5 pl-11">
                    {checks.map((check) => (
                      <li key={check.id} className="flex gap-2 text-[13px]">
                        <span
                          className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[2px] font-mono text-[11px] font-bold ${OUTCOME_STYLE[check.outcome].tone}`}
                        >
                          {OUTCOME_STYLE[check.outcome].mark}
                        </span>
                        <span className="min-w-0">
                          <span className="font-semibold">
                            {CHECKS[check.id].title}.
                          </span>{" "}
                          <span className="text-ink-muted">{check.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {item.job === hitsJob && run.hits && run.hits.length > 0 ? (
                  <ul className="mt-2.5 grid gap-1.5 border-ink/10 border-t pt-2.5 pl-11">
                    {run.hits.map((hit) => (
                      <li
                        key={`${hit.reference}-${hit.screenedName}`}
                        className="text-[13px]"
                      >
                        <span className="font-semibold">{hit.hitName}</span>{" "}
                        <span className="text-ink-muted">
                          ({hit.listType.replace("_", " ")}, {hit.score}% match
                          on {hit.screenedName})
                        </span>
                        {hit.disposition ? (
                          <span
                            className={`ml-1 font-mono text-[11px] font-bold uppercase ${DISPOSITION[hit.disposition].tone}`}
                          >
                            {DISPOSITION[hit.disposition].label}
                          </span>
                        ) : null}
                        {hit.dispositionReason ? (
                          <span className="block text-ink-muted">
                            {hit.dispositionReason}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {item.job === "reconcile" && run.arrears ? (
                  <p className="mt-2.5 border-ink/10 border-t pt-2.5 pl-11 text-[13px]">
                    Arrears{" "}
                    <span className="font-semibold">
                      {formatMoney(run.arrears.total)}
                    </span>
                    {run.arrears.interest > 0
                      ? `, plus about ${formatMoney(run.arrears.interest)} late interest`
                      : ""}
                    .
                  </p>
                ) : null}

                {item.job === "map_ownership" && run.ownership ? (
                  <div className="mt-2.5 border-ink/10 border-t pt-2.5">
                    <OwnershipView ownership={run.ownership} />
                  </div>
                ) : null}

                {item.job === "rate_risk" && run.risk ? (
                  <p className="mt-2.5 border-ink/10 border-t pt-2.5 pl-11 text-[13px]">
                    <span className="font-semibold capitalize">
                      {run.risk.rating} risk
                    </span>{" "}
                    <span className="text-ink-muted">
                      (score {run.risk.score}):{" "}
                      {run.risk.factors.join(", ") || "no risk factors"}
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      {run.documents.length > 0 ? (
        <section className="mt-5 pb-2">
          <SectionTitle>Documents it read · click to inspect</SectionTitle>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {run.documents.map((item) => {
              const doc = docs.get(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenDoc(item.id)}
                    className="flex w-full items-center gap-2.5 rounded-sm border border-ink/30 bg-paper p-1.5 text-left transition-colors hover:border-ink"
                  >
                    <span className="block h-14 w-10 shrink-0 overflow-hidden rounded-[2px] border border-ink/40 bg-limestone/50">
                      {doc?.thumbUrl ? (
                        // biome-ignore lint/performance/noImgElement: signed Storage URLs
                        <img
                          src={doc.thumbUrl}
                          alt=""
                          className="h-full w-full object-cover object-top"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">
                        {kindLabel(item.kind ?? "other")}
                      </span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {item.name || doc?.name}
                      </span>
                      <span className="block font-mono text-[10px] text-ink-muted">
                        {item.fields.length} fields read
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
