"use client";

import { motion } from "motion/react";
import { categoryLabel, toneOf } from "../domain/categories";
import type { SourceView } from "../domain/events";
import { type DraftGraph, ROOT_KEY } from "../domain/graph";

const SOURCE_GLYPH: Record<string, string> = {
  note: "✎",
  pdf: "PDF",
  image: "IMG",
  sheet: "XLS",
  doc: "DOC",
  text: "TXT",
};

/** One Node in full: what it is, what it says, where it came from, what it touches. */
export function NodeDrawer({
  nodeKey,
  graph,
  sources,
  clientName,
  onSelect,
  onClose,
}: {
  nodeKey: string;
  graph: DraftGraph;
  sources: SourceView[];
  clientName: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const node = graph.nodes.find((item) => item.key === nodeKey);
  if (!node) return null;
  const label = (key: string) =>
    key === ROOT_KEY
      ? clientName
      : (graph.nodes.find((item) => item.key === key)?.label ?? key);
  const tone = toneOf(node.category);
  const { branch, leaf } = categoryLabel(node.category);
  const links = graph.edges
    .filter((edge) => edge.from === node.key || edge.to === node.key)
    .map((edge) =>
      edge.from === node.key
        ? {
            other: edge.to,
            phrase: edge.label,
            outgoing: true,
            relation: edge.relation,
          }
        : {
            other: edge.from,
            phrase: edge.label,
            outgoing: false,
            relation: edge.relation,
          },
    );
  const sourceName = new Map(sources.map((source) => [source.id, source]));
  const attributes = Object.entries(node.attributes);

  return (
    <motion.aside
      key={node.key}
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      aria-label={`${node.label} details`}
      className="outline-box flex max-h-full flex-col overflow-hidden rounded-sm bg-paper shadow-hard-md"
    >
      <header
        className="flex items-start gap-3 border-ink border-b-2 p-4"
        style={{ background: `${tone}1f` }}
      >
        <span
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 rounded-full border-2 border-ink"
          style={{ background: tone }}
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-muted">
            {node.key === ROOT_KEY
              ? "The client"
              : `${branch} › ${leaf} · ${node.type}`}
          </p>
          <h3 className="mt-1 font-mono text-lg leading-tight font-bold [overflow-wrap:anywhere]">
            {node.key === ROOT_KEY ? clientName : node.label}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="outline-box press flex size-8 shrink-0 items-center justify-center rounded-sm bg-paper font-mono font-bold"
        >
          ×
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {node.summary ? (
          <p className="text-base leading-snug">{node.summary}</p>
        ) : null}
        {node.key !== ROOT_KEY ? (
          <div>
            <div className="eyebrow flex justify-between text-ink-muted">
              <span>Confidence</span>
              <span>{Math.round(node.confidence * 100)}%</span>
            </div>
            <div className="outline-box mt-1 h-2.5 overflow-hidden rounded-sm bg-marble">
              <motion.div
                className="h-full"
                style={{
                  background: node.confidence < 0.6 ? "#d9a84e" : "#2f6b3f",
                }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(node.confidence * 100)}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>
        ) : null}
        {attributes.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-ink border-t-2 pt-3">
            {attributes.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="eyebrow pt-0.5 text-ink-muted">
                  {name.replace(/_/g, " ")}
                </dt>
                <dd className="font-medium [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {node.evidence.some((item) => item.quote) ? (
          <section className="border-ink border-t-2 pt-3">
            <h4 className="eyebrow font-bold">Evidence</h4>
            <ul className="mt-2 space-y-2">
              {node.evidence
                .filter((item) => item.quote)
                .slice(0, 6)
                .map((item, index) => {
                  const source = sourceName.get(item.sourceId);
                  return (
                    <motion.li
                      key={`${item.sourceId}-${index}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.06 }}
                      className="border-brass border-l-4 bg-marble px-3 py-2"
                    >
                      <q className="italic">{item.quote}</q>
                      {source ? (
                        <span className="eyebrow mt-1 flex items-center gap-1.5 text-ink-muted">
                          <span className="outline-box rounded-sm bg-paper px-1 text-[0.6rem]">
                            {SOURCE_GLYPH[source.kind] ?? "SRC"}
                          </span>
                          {source.name}
                        </span>
                      ) : null}
                    </motion.li>
                  );
                })}
            </ul>
          </section>
        ) : null}
        {links.length > 0 ? (
          <section className="border-ink border-t-2 pt-3">
            <h4 className="eyebrow font-bold">Connections · {links.length}</h4>
            <ul className="mt-2 space-y-1">
              {links.map((link) => (
                <li key={`${link.relation}-${link.other}-${link.outgoing}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(link.other)}
                    className="group flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-morning-haze"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        background: toneOf(
                          graph.nodes.find((item) => item.key === link.other)
                            ?.category ?? "",
                        ),
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-muted">
                        {link.outgoing
                          ? link.phrase
                          : `${label(link.other)} ${link.phrase}`}
                      </span>{" "}
                      <span className="font-semibold group-hover:underline">
                        {link.outgoing ? label(link.other) : "this"}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="font-mono text-xs text-stone"
                    >
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </motion.aside>
  );
}
