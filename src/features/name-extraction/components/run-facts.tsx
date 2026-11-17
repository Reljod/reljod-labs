"use client";

import { useEffect, useState } from "react";
import {
  PURPOSES,
  type Purpose,
  type Score,
  TOOLS,
  type ToolId,
} from "../domain/contract";
import { SKILLS } from "../skills";
import { ConnectClient } from "./connect-client";
import { modelLabel, modelPrice, percent } from "./format";
import type { RunView } from "./run-view";
import { Panel, Tag } from "./ui";

export const MCP_PATH = "/api/name-extraction/mcp";

export const MCP_TOOLS = [
  { name: "list_corpus", hint: "The Corpus Documents, with split and pages" },
  { name: "extract_names", hint: "Starts a Run on a Corpus Document" },
  { name: "get_run", hint: "A Run's status, Register, cost and Score" },
  { name: "get_rulebook", hint: "The Rulebook in force, with its version" },
] as const;

/** How a corpus Run did against its Answer key. Recall is the headline. */
export function ScorePanel({ score }: { score: Score }) {
  return (
    <Panel
      eyebrow="Score"
      title="Against the answer key"
      bodyClassName="flex flex-col gap-3 p-4"
    >
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="eyebrow text-[0.62rem] text-ink-muted">Recall</p>
          <p className="font-mono text-4xl font-bold tabular-nums">
            {percent(score.recall)}
          </p>
          <p className="font-mono text-xs text-ink-muted">
            {score.truePositives} of {score.expected} expected
          </p>
        </div>
        <div>
          <p className="eyebrow text-[0.62rem] text-ink-muted">Precision</p>
          <p className="font-mono text-2xl font-bold tabular-nums">
            {percent(score.precision)}
          </p>
          <p className="font-mono text-xs text-ink-muted">
            {score.truePositives} of {score.found} found
          </p>
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Recall first: a missed name is a missed screening hit, an extra one
        costs an analyst one look.
      </p>
      {score.missed.length > 0 ? (
        <div>
          <p className="eyebrow mb-1 text-[0.62rem] text-seal-red">
            Missed ({score.missed.length})
          </p>
          <ul className="flex flex-wrap gap-1">
            {score.missed.map((name) => (
              <li key={name}>
                <Tag tone="red">{name}</Tag>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm font-semibold text-ivy">
          No expected name missed.
        </p>
      )}
    </Panel>
  );
}

/** What the open Run used: models, Skills, tools, the MCP endpoint and the Rulebook version. */
export function UsedPanel({ view }: { view: RunView }) {
  const tools = Object.entries(view.toolCounts) as [ToolId, number][];
  // Read after mount, so the server and the first client render agree.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Panel
      eyebrow="Provenance"
      title="What this run used"
      bodyClassName="flex flex-col gap-4 p-4 text-sm"
    >
      <section>
        <h3 className="eyebrow mb-1 text-[0.62rem] text-ink-muted">Models</h3>
        {view.models ? (
          <dl className="grid gap-1">
            {(Object.keys(PURPOSES) as Purpose[]).map((purpose) => {
              const model = view.models?.[purpose] ?? "";
              return (
                <div
                  key={purpose}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <dt className="font-semibold">{PURPOSES[purpose].label}</dt>
                  <dd>
                    {modelLabel(model)}{" "}
                    <code className="font-mono text-[0.68rem] text-ink-muted">
                      {model}
                    </code>
                    <span className="block text-xs text-ink-muted">
                      {modelPrice(model)}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="text-ink-muted">–</p>
        )}
      </section>
      <section>
        <h3 className="eyebrow mb-1 text-[0.62rem] text-ink-muted">Rulebook</h3>
        <p>
          {view.rulebookVersion === null
            ? "–"
            : view.rulebookVersion === 0
              ? "Version 0 (the default)"
              : `Version ${view.rulebookVersion}`}
        </p>
      </section>
      <section>
        <h3 className="eyebrow mb-1 text-[0.62rem] text-ink-muted">
          Skills loaded
        </h3>
        {view.skills.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {view.skills.map((skill) => (
              <li key={skill}>
                <Tag tone="blue" title={SKILLS[skill]?.description}>
                  {skill}
                </Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">None.</p>
        )}
      </section>
      <section>
        <h3 className="eyebrow mb-1 text-[0.62rem] text-ink-muted">
          Tools called
        </h3>
        {tools.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {tools.map(([tool, count]) => (
              <li key={tool}>
                <Tag title={TOOLS[tool]?.hint}>
                  {tool} ×{count}
                </Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">None yet.</p>
        )}
      </section>
      <section>
        <h3 className="eyebrow mb-1 text-[0.62rem] text-ink-muted">
          MCP endpoint
        </h3>
        <code className="block font-mono text-xs [overflow-wrap:anywhere]">
          {origin}
          {MCP_PATH}
        </code>
        <ul className="mt-1 flex flex-col gap-0.5">
          {MCP_TOOLS.map((tool) => (
            <li key={tool.name} className="text-xs">
              <code className="font-mono font-semibold">{tool.name}</code>{" "}
              <span className="text-ink-muted">{tool.hint}</span>
            </li>
          ))}
        </ul>
        <ConnectClient endpoint={`${origin}${MCP_PATH}`} />
      </section>
    </Panel>
  );
}
