"use client";

import { useState } from "react";
import { findPack } from "../../packs";
import { type PipelineNode, pipelineOf } from "../../pipeline";
import { DOCUMENT_ORDER } from "../../scan-events";
import type { EvaluationView, RunView } from "../../view";
import { DOCUMENT_LABELS } from "../labels";

const STATE_STYLES: Record<PipelineNode["state"], string> = {
  done: "border-l-ivy",
  error: "border-l-seal-red",
  skipped: "border-l-ink/30",
};

function NodeButton({
  node,
  selected,
  onSelect,
}: {
  node: PipelineNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`pipeline-node-${node.id}`}
      data-state={node.state}
      aria-pressed={selected}
      onClick={onSelect}
      className={`outline-box press flex h-full w-full flex-col gap-1 rounded-sm border-l-8 p-2.5 text-left ${STATE_STYLES[node.state]} ${
        selected ? "bg-morning-haze" : "bg-paper"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold uppercase">
          {node.title}
        </span>
        <span
          className={`eyebrow rounded-sm px-1.5 py-0.5 ${
            node.by === "model" ? "bg-brass text-ink" : "bg-ink text-paper"
          }`}
        >
          {node.by}
        </span>
      </span>
      <span className="font-mono text-[11px] text-ink-muted">
        {node.headline}
      </span>
    </button>
  );
}

/**
 * How the run got its Findings, as a graph: a lane per Document joining at
 * Evaluate. Pick a step to see what went in and what came out; the model is
 * one step of six and never decides a Finding.
 */
export function PipelineView({
  view,
  evaluation,
}: {
  view: RunView;
  evaluation: EvaluationView;
}) {
  const pack = findPack(view.packSlug);
  const kinds = DOCUMENT_ORDER.filter((kind) =>
    pack?.documents.some((document) => document.kind === kind),
  );
  const pipeline = pipelineOf(view, evaluation, kinds);
  const [selectedId, setSelectedId] = useState<string>("evaluate");
  const all = [
    ...pipeline.lanes.flatMap((lane) => lane.nodes),
    ...pipeline.join,
  ];
  const selected = all.find((node) => node.id === selectedId) ?? all[0];

  return (
    <section
      aria-label="Pipeline"
      data-testid="pipeline-view"
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-ink-muted">
        Each Document is parsed, read by the model, verified against its own
        page and checked field by field in parallel; code then applies the
        Rulebook of Evaluation {evaluation.number} to all of them.
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,4fr)_auto_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {pipeline.lanes.map((lane) => (
            <div key={lane.kind} className="flex flex-col gap-1.5">
              <span className="eyebrow text-ink-muted">
                {DOCUMENT_LABELS[lane.kind]}
              </span>
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {lane.nodes.map((node, index) => (
                  <li key={node.id} className="relative">
                    <NodeButton
                      node={node}
                      selected={node.id === selected.id}
                      onSelect={() => setSelectedId(node.id)}
                    />
                    {index < lane.nodes.length - 1 ? (
                      <span
                        aria-hidden
                        className="absolute top-1/2 -right-2 z-10 hidden -translate-y-1/2 font-mono text-xs sm:block"
                      >
                        ▸
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <span
          aria-hidden
          className="hidden items-center font-mono text-2xl lg:flex"
        >
          ⟶
        </span>
        <ol className="flex flex-col justify-center gap-2">
          {pipeline.join.map((node) => (
            <li key={node.id}>
              <NodeButton
                node={node}
                selected={node.id === selected.id}
                onSelect={() => setSelectedId(node.id)}
              />
            </li>
          ))}
        </ol>
      </div>

      <section
        aria-live="polite"
        data-testid="pipeline-detail"
        className="outline-box flex flex-col gap-2 rounded-sm bg-paper p-4"
      >
        <h3 className="font-mono text-sm font-bold uppercase">
          {selected.lane ? `${DOCUMENT_LABELS[selected.lane]} · ` : ""}
          {selected.title}{" "}
          <span className="font-normal text-ink-muted">
            ({selected.by === "model" ? "model" : "code"})
          </span>
        </h3>
        {selected.rows.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing was recorded for this step.
          </p>
        ) : (
          <dl className="grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            {selected.rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-muted">{row.label}</dt>
                <dd className="break-words font-bold">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </section>
  );
}
