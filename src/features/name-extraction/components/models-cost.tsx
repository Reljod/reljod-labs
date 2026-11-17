"use client";

import {
  MODEL_IDS,
  MODELS,
  type ModelChoice,
  PURPOSES,
  type Purpose,
} from "../domain/contract";
import { modelLabel, modelPrice, tokens, usd } from "./format";
import type { RunView } from "./run-view";
import { fieldClass, Panel } from "./ui";

const ROLE: Record<Purpose, { label: string; hint: string }> = {
  analyst: { label: "Lead agent", hint: "plans, checks and decides" },
  reader: { label: "Reader agents", hint: "read the pages, many at once" },
};

/**
 * Which models the next run uses, what each costs, and what the open run
 * spent on each.
 */
export function ModelsCost({
  models,
  onModels,
  view,
}: {
  models: ModelChoice;
  onModels: (models: ModelChoice) => void;
  view: RunView | null;
}) {
  const spent = view ? Object.entries(view.cost.byModel) : [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        eyebrow="For your next run"
        title="Models"
        bodyClassName="flex flex-col gap-4 p-4"
      >
        {(Object.keys(PURPOSES) as Purpose[]).map((purpose) => (
          <label key={purpose} className="flex min-w-0 flex-col gap-1 text-sm">
            <span>
              <span className="font-semibold">{ROLE[purpose].label}</span>{" "}
              <span className="text-ink-muted">{ROLE[purpose].hint}</span>
            </span>
            <select
              value={models[purpose]}
              onChange={(event) =>
                onModels({ ...models, [purpose]: event.target.value })
              }
              className={fieldClass}
            >
              {MODEL_IDS.map((model) => (
                <option key={model} value={model}>
                  {MODELS[model].label} · ${MODELS[model].input} in / $
                  {MODELS[model].output} out per M tokens
                </option>
              ))}
            </select>
            <code className="font-mono text-[0.68rem] text-ink-muted">
              {models[purpose]}
            </code>
          </label>
        ))}
      </Panel>
      <Panel
        eyebrow={
          view?.document ? view.document.title : "Open a run to see its spend"
        }
        title={
          view ? `Spend: ${usd(view.cost.total.costUsd)}` : "Spend by model"
        }
        bodyClassName="p-4"
      >
        {spent.length === 0 ? (
          <p className="text-sm text-ink-muted">No model calls to show.</p>
        ) : (
          <div className="sv-scroll overflow-x-auto">
            <table className="w-full min-w-[26rem] font-mono text-xs">
              <thead className="text-left text-ink-muted">
                <tr>
                  <th className="py-1 pr-2 font-normal">Model</th>
                  <th className="py-1 pr-2 text-right font-normal">Calls</th>
                  <th className="py-1 pr-2 text-right font-normal">
                    Tokens in / out
                  </th>
                  <th className="py-1 text-right font-normal">USD</th>
                </tr>
              </thead>
              <tbody>
                {spent.map(([model, line]) => (
                  <tr
                    key={model}
                    className="border-ink/10 border-t"
                    title={modelPrice(model)}
                  >
                    <td className="py-1.5 pr-2">
                      {modelLabel(model)}
                      <span className="block text-[0.65rem] text-ink-muted">
                        {model}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {line.calls}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {tokens(line.inputTokens)} / {tokens(line.outputTokens)}
                    </td>
                    <td className="py-1.5 text-right font-bold tabular-nums">
                      {usd(line.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
