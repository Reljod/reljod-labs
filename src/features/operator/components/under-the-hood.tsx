"use client";

import type { ReactNode } from "react";
import type { RunDetail } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { HowItWorks } from "./how-it-works";
import { cx, Panel, Tag } from "./ui";
import {
  actionRowsOf,
  codeRunsOf,
  count,
  duration,
  firedRulesOf,
  modelCallsOf,
  stopOf,
  tilesOf,
  usd,
} from "./under-the-hood-model";

const th =
  "border-ink border-b-2 bg-marble px-2 py-1.5 text-left font-mono text-[0.62rem] font-bold tracking-[0.08em] uppercase whitespace-nowrap";
const td = "border-ink/10 border-b px-2 py-1.5 align-top";

function Scroll({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full min-w-[34rem] border-collapse text-xs">
        {children}
      </table>
    </div>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}

const DECISION = {
  approved: { text: "approved", tone: "green" },
  refused: { text: "refused", tone: "red" },
  expired: { text: "nobody decided in time: refused", tone: "red" },
  waiting: { text: "waiting for a person", tone: "brass" },
} as const;

function RunDepth({ run }: { run: RunDetail }) {
  const actions = actionRowsOf(run.events);
  const calls = modelCallsOf(run.events);
  const fired = firedRulesOf(run.events);
  const stop = stopOf(run);
  const code = codeRunsOf(run.events);

  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tilesOf(run).map((tile) => (
          <li
            key={tile.label}
            className="outline-box flex min-w-0 flex-col gap-0.5 rounded-sm bg-paper px-3 py-2 shadow-hard-sm"
          >
            <span className="eyebrow text-[0.6rem] text-ink-muted">
              {tile.label}
            </span>
            <span className="truncate font-mono text-base font-bold tabular-nums">
              {tile.value}
            </span>
            {tile.hint ? (
              <span className="text-[0.65rem] text-ink-muted">{tile.hint}</span>
            ) : null}
          </li>
        ))}
      </ul>

      <Panel eyebrow="Why it stopped" title={stop.headline}>
        {stop.detail ? (
          <p className="mb-3 text-sm [overflow-wrap:anywhere]">{stop.detail}</p>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {stop.caps.map((cap) => (
            <li key={cap.label} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold">{cap.label}</span>
                <span className="font-mono tabular-nums">
                  {cap.used} / {cap.limit}
                </span>
              </span>
              <span className="h-2 rounded-sm border border-ink bg-marble">
                <span
                  className={cx(
                    "block h-full",
                    cap.hit ? "bg-seal-red" : "bg-federal-blue",
                  )}
                  style={{ width: `${Math.round(cap.share * 100)}%` }}
                />
              </span>
              {cap.hit ? <Tag tone="red">ended the Run</Tag> : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-muted">
          A pause waits at most {LIMITS.approvalWaitMinutes} minutes for a
          person, then the Action is refused.
        </p>
      </Panel>

      <Panel
        eyebrow="Actions"
        title={`${count(actions.length)} Actions, from the Frames`}
        bodyClassName=""
      >
        {actions.length === 0 ? (
          <div className="p-4">
            <Quiet>No Action yet.</Quiet>
          </div>
        ) : (
          <Scroll>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Frame
                </th>
                <th scope="col" className={th}>
                  Turn
                </th>
                <th scope="col" className={th}>
                  Action
                </th>
                <th scope="col" className={th}>
                  Screen
                </th>
                <th scope="col" className={cx(th, "text-right")}>
                  ms
                </th>
                <th scope="col" className={th}>
                  Committed
                </th>
              </tr>
            </thead>
            <tbody>
              {actions.map((row) => (
                <tr
                  key={row.n}
                  className={row.slowest ? "bg-brass/20" : undefined}
                >
                  <td className={cx(td, "font-mono tabular-nums")}>{row.n}</td>
                  <td className={cx(td, "font-mono tabular-nums")}>
                    {row.turn}
                  </td>
                  <td className={td}>
                    <code className="font-mono [overflow-wrap:anywhere]">
                      {row.label}
                    </code>
                    {row.intent ? (
                      <span className="block text-ink-muted">{row.intent}</span>
                    ) : null}
                  </td>
                  <td className={cx(td, "font-mono")}>{row.screen}</td>
                  <td className={cx(td, "text-right font-mono tabular-nums")}>
                    {count(row.ms)}
                    {row.slowest ? (
                      <span className="block font-bold text-oak">slowest</span>
                    ) : null}
                  </td>
                  <td className={td}>
                    {row.committed.length > 0 ? (
                      row.committed.join("; ")
                    ) : (
                      <span className="text-ink-muted">nothing</span>
                    )}
                    {row.message ? (
                      <span className="block font-mono text-[0.65rem] text-ink-muted">
                        {row.message}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Scroll>
        )}
      </Panel>

      <Panel
        eyebrow="Model calls"
        title={`${count(calls.length)} calls on the AI Gateway`}
        bodyClassName=""
      >
        {calls.length === 0 ? (
          <div className="p-4">
            <Quiet>
              {run.driver === "hand"
                ? "No model calls: a person drove this Run."
                : run.driver === "client"
                  ? "No model calls here: an outside client drove this Run, and its own model calls are not counted by this site."
                  : "No model call yet."}
            </Quiet>
          </div>
        ) : (
          <Scroll>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Turn
                </th>
                <th scope="col" className={cx(th, "text-right")}>
                  Tokens in
                </th>
                <th scope="col" className={cx(th, "text-right")}>
                  Cached
                </th>
                <th scope="col" className={cx(th, "text-right")}>
                  Out
                </th>
                <th scope="col" className={cx(th, "text-right")}>
                  Cost
                </th>
                <th scope="col" className={th}>
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call, index) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: a Turn may log more than one call; the list is append-only
                  key={index}
                >
                  <td className={cx(td, "font-mono tabular-nums")}>
                    {call.turn}
                  </td>
                  <td className={cx(td, "text-right font-mono tabular-nums")}>
                    {count(call.inputTokens)}
                  </td>
                  <td className={cx(td, "text-right font-mono tabular-nums")}>
                    {count(call.cachedInputTokens)}
                  </td>
                  <td className={cx(td, "text-right font-mono tabular-nums")}>
                    {count(call.outputTokens)}
                  </td>
                  <td className={cx(td, "text-right font-mono tabular-nums")}>
                    {usd(call.costUsd)}
                  </td>
                  <td className={cx(td, "w-48")}>
                    <span className="flex items-center gap-2">
                      <span className="h-2 flex-1 rounded-sm border border-ink/40 bg-marble">
                        <span
                          className="block h-full bg-federal-blue"
                          style={{ width: `${Math.round(call.share * 100)}%` }}
                        />
                      </span>
                      <span className="w-14 text-right font-mono tabular-nums">
                        {duration(call.ms)}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Scroll>
        )}
      </Panel>

      <Panel eyebrow="Rules that fired" title={`${fired.length} times`}>
        {fired.length === 0 ? (
          <Quiet>No Rule refused or paused an Action in this Run.</Quiet>
        ) : (
          <ol className="flex flex-col gap-2">
            {fired.map((rule) => (
              <li
                key={rule.seq}
                className="flex flex-col gap-1 rounded-sm border-2 border-ink/15 p-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{rule.title}</span>
                  <Tag tone={rule.outcome === "paused" ? "brass" : "red"}>
                    {rule.outcome}
                  </Tag>
                  <span className="ml-auto font-mono text-[0.65rem] text-ink-muted">
                    Frame {rule.frame} · {rule.screen}
                  </span>
                </span>
                <span className="text-xs">{rule.reason}</span>
                <span className="text-xs text-ink-muted">
                  Stopped <code className="font-mono">{rule.label}</code>
                </span>
                {rule.pause ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <Tag tone={DECISION[rule.pause.decision].tone}>
                      {DECISION[rule.pause.decision].text}
                    </Tag>
                    {rule.pause.waitedMs !== null ? (
                      <span className="text-ink-muted">
                        after {duration(rule.pause.waitedMs)}
                      </span>
                    ) : null}
                    {rule.pause.note ? <span>{rule.pause.note}</span> : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        eyebrow="Code sandbox"
        title={`${code.length} of ${LIMITS.codeRunsPerRun} code runs`}
      >
        {code.length === 0 ? (
          <Quiet>The driver ran no code in this Run.</Quiet>
        ) : (
          <ol className="flex flex-col gap-2">
            {code.map((item) => (
              <li key={item.callId}>
                <details className="rounded-sm border-2 border-ink/15">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <code className="font-mono">{item.callId}</code>
                    {item.running ? (
                      <Tag tone="blue">running</Tag>
                    ) : (
                      <Tag tone={item.exitCode === 0 ? "green" : "red"}>
                        exit {item.exitCode}
                      </Tag>
                    )}
                    <span className="ml-auto font-mono text-ink-muted">
                      {duration(item.ms)}
                    </span>
                  </summary>
                  <pre className="max-h-72 overflow-auto border-ink/10 border-t bg-marble/60 p-3 font-mono text-[0.68rem] whitespace-pre-wrap">
                    {item.code}
                  </pre>
                  {item.stdout ? (
                    <pre className="max-h-48 overflow-auto border-ink/10 border-t p-3 font-mono text-[0.68rem] whitespace-pre-wrap">
                      {item.stdout}
                    </pre>
                  ) : null}
                  {item.stderr ? (
                    <pre className="max-h-48 overflow-auto border-ink/10 border-t p-3 font-mono text-[0.68rem] whitespace-pre-wrap text-seal-red">
                      {item.stderr}
                    </pre>
                  ) : null}
                </details>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}

/**
 * The depth of the open Run: what it cost and took, every Action and model
 * call, the Rules that fired, why it stopped and the code it ran. All of it
 * comes from the Run itself (under-the-hood-model.ts). Then how it works.
 */
export function UnderTheHood({ run }: { run: RunDetail | null }) {
  return (
    <div className="flex flex-col gap-4">
      {run ? (
        <RunDepth run={run} />
      ) : (
        <Panel eyebrow="Under the hood" title="No Run open">
          <Quiet>
            Open a Run, or start one, to see its Turns, Actions, model calls,
            the Rules that fired and what it cost. A recorded Run costs nothing
            to open.
          </Quiet>
        </Panel>
      )}
      <HowItWorks />
    </div>
  );
}
