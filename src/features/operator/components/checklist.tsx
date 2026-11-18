"use client";

import type { ReactNode } from "react";
import type { Finding, FindingLevel, Verdict } from "../domain/checks";
import { STOPPED_BY_LABEL } from "./format";
import { groupFindings, isOver, type PlanItem, type RunView } from "./run-view";
import { cx, Panel, Tag, type TagTone } from "./ui";

/** What each Verdict means, in the glossary's words. */
export const VERDICT: Record<
  Verdict,
  { word: string; tone: TagTone; box: string; meaning: string }
> = {
  correct: {
    word: "Correct",
    tone: "green",
    box: "bg-ivy text-paper",
    meaning:
      "Code compared the Books with what the Task asked. Nothing failed.",
  },
  incorrect: {
    word: "Incorrect",
    tone: "red",
    box: "bg-seal-red text-paper",
    meaning: "At least one check failed. The Findings below say which.",
  },
  unverified: {
    word: "Unverified",
    tone: "brass",
    box: "bg-brass text-ink",
    meaning:
      "The Rules held, but there was nothing to compare the outcome with: an own Task without a Manifest.",
  },
};

export function VerdictTag({ verdict }: { verdict: Verdict | null }) {
  return verdict ? (
    <Tag tone={VERDICT[verdict].tone}>{VERDICT[verdict].word}</Tag>
  ) : (
    <Tag>no Verdict</Tag>
  );
}

function Box({ ticked }: { ticked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "mt-0.5 grid size-4 shrink-0 place-items-center border-2 border-ink font-mono text-[0.65rem] leading-none font-bold transition-colors",
        ticked ? "bg-ivy text-paper" : "bg-paper",
      )}
    >
      {ticked ? "✓" : ""}
    </span>
  );
}

/** The Task's Expectations, ticked from what code last saw in the Books. */
export function Expectations({
  expected,
  met,
}: {
  expected: string[];
  met: boolean[];
}) {
  const done = met.filter(Boolean).length;
  return (
    <Panel
      eyebrow="Checked by code"
      title={
        expected.length > 0
          ? `Checklist: ${done} of ${expected.length}`
          : "Checklist"
      }
    >
      {expected.length === 0 ? (
        <p className="text-sm text-ink-muted">
          An own Task has no Expectations to tick. Code still applies the Rules,
          and compares the Books with the Manifest if one is attached.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {expected.map((label, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Expectations are a fixed list and two may read the same
              <li key={index} className="flex gap-2 text-sm">
                <Box ticked={met[index] === true} />
                <span className={met[index] ? "" : "text-ink-muted"}>
                  {label}
                  <span className="sr-only">
                    {met[index] ? " (met)" : " (not met yet)"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">
            Code reads the Books after every commit. The Operator never ticks
            its own work.
          </p>
        </>
      )}
    </Panel>
  );
}

export function Plan({ items }: { items: PlanItem[] }) {
  if (items.length === 0) return null;
  return (
    <Panel eyebrow="Its own words, not a check" title="The Operator's plan">
      <ol className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a plan is rewritten whole and items may repeat
          <li key={index} className="flex gap-2 text-sm">
            <span aria-hidden="true" className="font-mono text-ink-muted">
              {item.done ? "■" : "□"}
            </span>
            <span className={item.done ? "text-ink-muted line-through" : ""}>
              {item.text}
              {item.done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const LEVEL: Record<FindingLevel, { title: string; tone: TagTone }> = {
  fail: { title: "Failed", tone: "red" },
  warn: { title: "Warnings", tone: "brass" },
  pass: { title: "Passed", tone: "green" },
  info: { title: "For the record", tone: "neutral" },
};

export function Findings({ findings }: { findings: Finding[] }) {
  const groups = groupFindings(findings);
  if (groups.length === 0) return null;
  return (
    <Panel eyebrow="Returned by code" title={`${findings.length} Findings`}>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.level} className="flex flex-col gap-2">
            <h3 className="eyebrow flex items-center gap-2 text-[0.65rem]">
              <Tag tone={LEVEL[group.level].tone}>{group.findings.length}</Tag>
              {LEVEL[group.level].title}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.findings.map((finding, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: Findings have no id of their own and a Rule may return several
                  key={index}
                  className={cx(
                    "border-l-4 pl-2 text-sm",
                    group.level === "fail" && "border-seal-red",
                    group.level === "warn" && "border-brass",
                    group.level === "pass" && "border-ivy",
                    group.level === "info" && "border-ink/25",
                  )}
                >
                  <p>{finding.title}</p>
                  <p className="font-mono text-[0.68rem] text-ink-muted">
                    {finding.id}
                  </p>
                  {finding.detail ? (
                    <p className="mt-0.5 text-xs whitespace-pre-wrap text-ink-muted">
                      {finding.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}

/**
 * The Verdict, big, with its plain meaning; announced when it lands. `shown`
 * is false while a replay has not reached the end, so the ending is not
 * given away.
 */
export function VerdictCard({
  view,
  shown,
  children,
}: {
  view: RunView;
  shown: boolean;
  children?: ReactNode;
}) {
  const over = isOver(view.status);
  const verdict = view.verdict;
  return (
    <div aria-live="polite">
      {over && shown ? (
        <section className="outline-box rounded-sm bg-paper shadow-hard-md">
          <div
            className={cx(
              "border-ink border-b-2 px-4 py-3",
              verdict ? VERDICT[verdict].box : "bg-marble",
            )}
          >
            <p className="eyebrow text-[0.65rem] opacity-80">
              Verdict, computed from the Findings
            </p>
            <p
              data-testid="verdict"
              className="font-mono text-3xl leading-tight font-bold uppercase"
            >
              {verdict ? VERDICT[verdict].word : "No Verdict"}
            </p>
          </div>
          <div className="flex flex-col gap-2 p-4 text-sm">
            <p>
              {verdict
                ? VERDICT[verdict].meaning
                : "The Run ended before the checks ran, so code has nothing to say about it."}
            </p>
            {view.status !== "completed" || view.stoppedBy !== "finish" ? (
              <p className="text-ink-muted">
                {view.status === "failed"
                  ? "The Run failed."
                  : view.status === "stopped"
                    ? "The Run was stopped."
                    : "The Run ended."}
                {view.stoppedBy && view.stoppedBy !== "finish"
                  ? ` Ended by ${STOPPED_BY_LABEL[view.stoppedBy]}.`
                  : ""}
              </p>
            ) : null}
            {view.error ? <p className="text-seal-red">{view.error}</p> : null}
            {view.summary ? (
              <p className="border-ink/15 border-t pt-2 text-xs text-ink-muted">
                <span className="font-semibold">The Driver's own summary</span>{" "}
                (not a check): {view.summary}
              </p>
            ) : null}
            {children}
          </div>
        </section>
      ) : null}
    </div>
  );
}
