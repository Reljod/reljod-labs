"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clock,
  type Process,
  type ProcessStep,
  type Watch,
} from "../../domain/process";
import { isOver, type RunView } from "../../domain/run";
import { plural } from "../format";
import { focusRing, Panel, Skeleton } from "../ui";
import { ChecksList, checksLine, FindingsList } from "./checks-list";
import { RESULT_ANCHOR } from "./stage-results";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The Process as it fills in: who hands what to whom, then every Step as a
 * timeline with its time in the Recording, then the Process Checks and the
 * reviewer's Findings. Before the Process exists, the Observations stream in
 * as a transcript.
 */
export function StepsPanel({
  run,
  onSeek,
}: {
  run: RunView;
  onSeek: (seconds: number) => void;
}) {
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const stage = (id: string) =>
    run.stages.find((item) => item.id === id)?.status;

  const goToStep = useCallback((stepId: string) => {
    const element = document.getElementById(`ho-step-${stepId}`);
    if (!element) return;
    element.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
    element.focus({ preventScroll: true });
    setFlash((current) => ({ id: stepId, n: (current?.n ?? 0) + 1 }));
  }, []);

  const process = run.process;
  if (!process) {
    if (run.watch && run.watch.observations.length > 0) {
      return (
        <div className="flex flex-col gap-4">
          <p aria-live="polite" className="text-sm text-ink-muted">
            {stage("extract") === "running"
              ? "Writing the Process from what was said and shown…"
              : "What the call said and showed, moment by moment."}
          </p>
          <div id={RESULT_ANCHOR.transcript} tabIndex={-1}>
            <Transcript watch={run.watch} onSeek={onSeek} />
          </div>
        </div>
      );
    }
    if (run.status === "failed" || run.status === "stopped") {
      return (
        <p className="text-sm text-ink-muted">
          {run.status === "stopped"
            ? "The Run was stopped before a Process was written."
            : "The Run ended before a Process was written."}
          {run.error ? ` ${run.error}` : ""}
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="text-sm text-ink-muted">
          Watching the Recording. The moments of the call appear here as they
          are read.
        </p>
        <Skeleton lines={5} />
      </div>
    );
  }

  const stepName = (target: string | null) => {
    if (!target) return null;
    const index = process.steps.findIndex((step) => step.id === target);
    return index === -1 ? null : `Step ${index + 1}`;
  };
  const target = { name: stepName, go: goToStep };
  const processRules = run.rules.filter((rule) => rule.group === "process");
  const repaired = run.calls.some((call) => /repair/i.test(call.label));

  return (
    <div className="flex flex-col gap-6">
      <ProcessHeader process={process} />
      <section
        id={RESULT_ANCHOR.steps}
        tabIndex={-1}
        aria-labelledby="ho-steps-title"
        className="flex flex-col gap-3 focus:outline-none"
      >
        <h3 id="ho-steps-title" className="eyebrow flex items-baseline gap-2">
          <span className="font-bold">Steps</span>
          <span className="text-ink-muted">
            {plural(process.steps.length, "step")} · click a time to watch it
          </span>
        </h3>
        <ol className="flex flex-col">
          {process.steps.map((step, index) => (
            <StepItem
              key={step.id}
              step={step}
              number={index + 1}
              last={index === process.steps.length - 1}
              flash={flash?.id === step.id ? flash.n : 0}
              onSeek={onSeek}
            />
          ))}
        </ol>
      </section>
      <Panel
        id={RESULT_ANCHOR.processChecks}
        eyebrow="Process Checks"
        title={
          run.processChecks.length > 0
            ? checksLine(run.processChecks)
            : stage("verify") === "done" || isOver(run.status)
              ? "No Process Checks"
              : "Waiting for Verify"
        }
      >
        <ChecksList
          checks={run.processChecks}
          rules={processRules.length > 0 ? processRules : run.rules}
          target={target}
          empty={
            stage("verify") === "done" || isOver(run.status)
              ? "No Process Rules were on for this Run."
              : "The Process Checks run during Verify."
          }
        />
      </Panel>
      <Panel eyebrow="Reviewer" title="Findings on the Process">
        {repaired && run.processFindings.length > 0 ? (
          <p className="mb-3 text-sm text-ink-muted">
            Raised on the first read. Verify sent them back for one repair, and
            the steps above are the repaired ones.
          </p>
        ) : null}
        <FindingsList
          findings={run.processFindings}
          target={target}
          empty={
            stage("verify") === "done"
              ? "The reviewer found every step in the Recording."
              : "The reviewer reads the steps against the Recording during Verify."
          }
        />
      </Panel>
      {run.watch && run.watch.observations.length > 0 ? (
        <details
          id={RESULT_ANCHOR.transcript}
          className="group outline-box rounded-sm bg-paper"
        >
          <summary
            className={`flex min-h-10 cursor-pointer list-none items-center justify-between px-4 font-mono text-xs font-bold tracking-[0.1em] uppercase ${focusRing}`}
          >
            Transcript · {plural(run.watch.observations.length, "moment")}
            <span
              aria-hidden="true"
              className="transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="border-ink border-t-2 p-4">
            <Transcript watch={run.watch} onSeek={onSeek} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProcessHeader({ process }: { process: Process }) {
  return (
    <header className="ho-in flex flex-col gap-4">
      <div>
        <p className="eyebrow text-ink-muted">Process</p>
        <h2 className="font-mono text-xl font-bold leading-tight tracking-[0.02em] uppercase">
          {process.title}
        </h2>
        <p className="mt-2 max-w-prose">{process.purpose}</p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Fact label="Starts when">{process.trigger}</Fact>
        {process.frequency ? (
          <Fact label="How often">{process.frequency}</Fact>
        ) : null}
        <Fact label="Handed over">
          {process.owner} <span aria-hidden="true">→</span>
          <span className="sr-only">to</span> {process.receiver}
        </Fact>
        {process.scope ? <Fact label="Scope">{process.scope}</Fact> : null}
      </dl>
      <div className="flex flex-col gap-2">
        {process.roles.length > 0 ? (
          <ChipRow
            label="Roles"
            items={process.roles.map((role) => ({
              key: role.name,
              text: role.name,
              title: role.responsibility,
            }))}
          />
        ) : null}
        {process.systems.length > 0 ? (
          <ChipRow
            label="Systems"
            items={process.systems.map((system) => ({
              key: system.name,
              text: system.name,
              title: system.usedFor,
            }))}
            mono
          />
        ) : null}
      </div>
    </header>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-ink-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function ChipRow({
  label,
  items,
  mono = false,
}: {
  label: string;
  items: { key: string; text: string; title: string }[];
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow mr-1 text-ink-muted">{label}</span>
      {items.map((item) => (
        <span
          key={item.key}
          title={item.title}
          className={`rounded-sm border border-ink/30 bg-paper px-2 py-0.5 text-xs ${mono ? "font-mono" : "font-medium"}`}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

/** A button showing a time in the Recording: plays the video from there. */
export function TimeChip({
  at,
  onSeek,
  label,
}: {
  at: number;
  onSeek: (seconds: number) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSeek(at)}
      aria-label={label ?? `Play the Recording from ${clock(at)}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-[11px] font-bold text-paper hover:bg-federal-blue ${focusRing}`}
    >
      <span aria-hidden="true">▶</span>
      {clock(at)}
    </button>
  );
}

function StepItem({
  step,
  number,
  last,
  flash,
  onSeek,
}: {
  step: ProcessStep;
  number: number;
  last: boolean;
  flash: number;
  onSeek: (seconds: number) => void;
}) {
  const card = useRef<HTMLElement>(null);
  // Restart the highlight each time a Check points here again.
  useEffect(() => {
    const element = card.current;
    if (!element || flash === 0) return;
    element.classList.remove("ho-flash");
    void element.offsetWidth;
    element.classList.add("ho-flash");
  }, [flash]);
  return (
    <li className="relative flex gap-3 pb-4">
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute top-9 bottom-0 left-[17px] w-0.5 bg-ink/25"
        />
      )}
      <span className="outline-box z-[1] flex size-9 shrink-0 items-center justify-center rounded-sm bg-paper font-mono text-sm font-bold">
        {number}
      </span>
      <article
        ref={card}
        id={`ho-step-${step.id}`}
        tabIndex={-1}
        aria-labelledby={`ho-step-${step.id}-title`}
        className={`outline-box ho-in min-w-0 flex-1 rounded-sm bg-paper p-3 shadow-hard-sm focus:outline-none`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h4
            id={`ho-step-${step.id}-title`}
            className="font-semibold leading-snug"
          >
            {step.title}
          </h4>
          <TimeChip
            at={step.at}
            onSeek={onSeek}
            label={`Play step ${number} from ${clock(step.at)}`}
          />
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-muted uppercase">
          <span>
            <span className="sr-only">Who: </span>
            {step.actor}
          </span>
          {step.system ? (
            <span>
              <span aria-hidden="true">· </span>
              <span className="sr-only">Where: </span>
              {step.system}
            </span>
          ) : null}
        </p>
        <p className="mt-2">{step.action}</p>
        {step.details.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-0.5 text-sm">
            {step.details.map((detail) => (
              <li key={detail} className="flex gap-2">
                <span aria-hidden="true" className="text-federal-blue">
                  ▪
                </span>
                <span className="min-w-0 break-words">{detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {step.warning ? (
          <p className="mt-3 rounded-sm border-l-4 border-brass bg-brass/15 px-3 py-2 text-sm">
            <span className="font-mono text-[11px] font-bold tracking-[0.08em] uppercase">
              Watch out ·{" "}
            </span>
            {step.warning}
          </p>
        ) : null}
        {step.decision ? (
          <div className="mt-3 rounded-sm border border-ink/25 bg-morning-haze/50 p-3">
            <p className="text-sm font-semibold">{step.decision.question}</p>
            <dl className="mt-2 flex flex-col gap-1.5 text-sm">
              {step.decision.branches.map((branch) => (
                <div
                  key={branch.when}
                  className="grid gap-x-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)]"
                >
                  <dt>
                    <span className="font-mono text-[11px] font-bold text-federal-blue uppercase">
                      If{" "}
                    </span>
                    {branch.when}
                  </dt>
                  <span
                    aria-hidden="true"
                    className="hidden text-ink-muted sm:inline"
                  >
                    →
                  </span>
                  <dd>
                    <span className="font-mono text-[11px] font-bold text-federal-blue uppercase sm:hidden">
                      Then{" "}
                    </span>
                    {branch.then}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </article>
    </li>
  );
}

/** The Observations: time, speaker, what was said and what was shown. */
function Transcript({
  watch,
  onSeek,
}: {
  watch: Watch;
  onSeek: (seconds: number) => void;
}) {
  return (
    <ol
      className="flex flex-col gap-3"
      aria-live="polite"
      aria-relevant="additions"
    >
      {watch.observations.map((item, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: observations are append-only and carry no id
          key={index}
          className="ho-in grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3"
        >
          <TimeChip at={item.at} onSeek={onSeek} />
          <div className="min-w-0 text-sm">
            {item.said.trim() ? (
              <p>
                <span className="font-semibold">
                  {item.speaker ?? "Speaker"}:{" "}
                </span>
                {item.said}
              </p>
            ) : null}
            {item.shown ? (
              <p
                className={
                  item.said.trim() ? "mt-0.5 text-ink-muted" : "text-ink-muted"
                }
              >
                <span className="font-mono text-[10px] font-bold tracking-[0.08em] uppercase">
                  Screen ·{" "}
                </span>
                {item.shown}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
