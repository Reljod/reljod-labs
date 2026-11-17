"use client";

import { type ReactNode, useMemo } from "react";
import {
  MODELS,
  type ModelId,
  PURPOSE_IDS,
  PURPOSES,
} from "../../domain/models";
import { type RunView, STAGES } from "../../domain/run";
import {
  costByPurpose,
  isReplaced,
  latestGeneration,
  modelLabel,
  stageOfCall,
  totalOf,
} from "../cost";
import { clockTime, count, elapsed, plural, usd } from "../format";
import { Panel } from "../ui";

const STAGE_LABEL = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.label]),
);

/**
 * Every model call this Run made, with tokens, cost and time; totals per
 * purpose and overall; and the models and Rules version the Run ran under.
 */
export function CostPanel({ run }: { run: RunView }) {
  const byPurpose = useMemo(() => costByPurpose(run.calls), [run.calls]);
  const total = useMemo(() => totalOf(run.calls), [run.calls]);
  const latest = latestGeneration(run.calls);
  const totalUsd = Math.max(run.costUsd, total.costUsd);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Total cost" value={usd(totalUsd)} strong />
        <Figure label="Model calls" value={String(total.calls)} />
        <Figure label="Tokens in" value={count(total.inputTokens)} />
        <Figure label="Tokens out" value={count(total.outputTokens)} />
      </div>

      {latest > 0 ? (
        <p className="text-sm text-ink-muted">
          This Run&apos;s Deck was redone{" "}
          {latest === 1 ? "once" : `${latest} times`}. Calls marked{" "}
          <span className="font-mono text-xs font-bold">Redo n</span> came from
          a Redo; greyed calls made Rounds that a later Redo replaced. The
          totals count every call, because every call was paid for.
        </p>
      ) : null}
      <Panel eyebrow="Every call" title="Model calls">
        {run.calls.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No model has been called yet.
          </p>
        ) : (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">
                Every model call this Run made
              </caption>
              <thead>
                <tr className="border-ink border-b-2 text-left">
                  <Th>Stage</Th>
                  <Th>What for</Th>
                  <Th>Model</Th>
                  <Th right>In</Th>
                  <Th right>Out</Th>
                  <Th right>Cost</Th>
                  <Th right>Time</Th>
                </tr>
              </thead>
              <tbody>
                {run.calls.map((call) => (
                  <tr
                    key={call.id}
                    className={`border-ink/10 border-b align-top ${isReplaced(call, latest) ? "text-ink-muted" : ""}`}
                  >
                    <Td>
                      <span className="font-mono text-xs font-bold uppercase">
                        {STAGE_LABEL[stageOfCall(call)]}
                      </span>
                    </Td>
                    <Td>
                      {call.label}
                      {(call.generation ?? 0) > 0 ? (
                        <span className="ml-2 rounded-sm bg-morning-haze px-1 font-mono text-[10px] font-bold uppercase">
                          Redo {call.generation}
                        </span>
                      ) : null}
                      <span className="block font-mono text-[11px] text-ink-muted">
                        {clockTime(call.at)}
                        {isReplaced(call, latest)
                          ? " · its Round was replaced by a Redo"
                          : ""}
                      </span>
                    </Td>
                    <Td>
                      <span className="whitespace-nowrap">
                        {modelLabel(call.model)}
                      </span>
                    </Td>
                    <Td right mono>
                      {count(call.inputTokens)}
                    </Td>
                    <Td right mono>
                      {count(call.outputTokens)}
                    </Td>
                    <Td right mono>
                      {usd(call.costUsd)}
                    </Td>
                    <Td right mono>
                      {elapsed(call.ms)}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {PURPOSE_IDS.filter(
                  (purpose) => byPurpose[purpose].calls > 0,
                ).map((purpose) => {
                  const line = byPurpose[purpose];
                  return (
                    <tr
                      key={purpose}
                      className="border-ink/10 border-b bg-marble/60"
                    >
                      <Td colSpan={3}>
                        <span className="font-semibold">
                          {PURPOSES[purpose].label}
                        </span>
                        <span className="text-ink-muted">
                          {" "}
                          · {plural(line.calls, "call")} ·{" "}
                          {line.models.map(modelLabel).join(", ")}
                        </span>
                      </Td>
                      <Td right mono>
                        {count(line.inputTokens)}
                      </Td>
                      <Td right mono>
                        {count(line.outputTokens)}
                      </Td>
                      <Td right mono>
                        {usd(line.costUsd)}
                      </Td>
                      <Td right mono>
                        {elapsed(line.ms)}
                      </Td>
                    </tr>
                  );
                })}
                <tr className="border-ink border-t-2 bg-limestone/60 font-bold">
                  <Td colSpan={3}>Total</Td>
                  <Td right mono>
                    {count(total.inputTokens)}
                  </Td>
                  <Td right mono>
                    {count(total.outputTokens)}
                  </Td>
                  <Td right mono>
                    {usd(totalUsd)}
                  </Td>
                  <Td right mono>
                    {elapsed(total.ms)}
                  </Td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel eyebrow="Fixed when the Run started" title="Models used">
          <dl className="flex flex-col gap-2 text-sm">
            {PURPOSE_IDS.map((purpose) => {
              const id = run.models[purpose];
              const price = MODELS[id as ModelId];
              return (
                <div
                  key={purpose}
                  className="flex flex-wrap items-baseline justify-between gap-x-3"
                >
                  <dt>
                    <span className="font-semibold">
                      {PURPOSES[purpose].label}
                    </span>
                    <span className="text-ink-muted">
                      {" "}
                      · {PURPOSES[purpose].hint}
                    </span>
                  </dt>
                  <dd className="font-mono text-xs">
                    {modelLabel(id)}
                    {price ? (
                      <span className="text-ink-muted">
                        {" "}
                        (${price.input} in / ${price.output} out per M tokens)
                      </span>
                    ) : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Panel>
        <Panel
          eyebrow="Fixed when the Run started"
          title={`Rules version ${run.rulesVersion}`}
        >
          <p className="text-sm">
            {run.rules.filter((rule) => rule.enabled).length} of{" "}
            {run.rules.length} Rules on;{" "}
            {run.rules.filter((rule) => rule.edited).length} changed from the
            default.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Costs are what the AI gateway reported, or list price when it did
            not. The Document Stage and Approval call no model.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`outline-box rounded-sm px-3 py-2 ${strong ? "bg-ink text-paper" : "bg-paper"}`}
    >
      <p className={`eyebrow ${strong ? "text-paper/70" : "text-ink-muted"}`}>
        {label}
      </p>
      <p className="font-mono text-lg font-bold">{value}</p>
    </div>
  );
}

function Th({
  children,
  right = false,
}: {
  children: ReactNode;
  right?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`eyebrow px-3 py-2 font-bold whitespace-nowrap ${right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right = false,
  mono = false,
  colSpan,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-2 ${right ? "text-right whitespace-nowrap" : ""} ${mono ? "font-mono text-xs" : ""}`}
    >
      {children}
    </td>
  );
}
