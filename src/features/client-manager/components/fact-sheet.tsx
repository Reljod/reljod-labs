"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import type { NodeLite, SourceSummary } from "../domain/api";
import { categoryLabel, toneOf } from "../domain/categories";
import { CERTAINTY_STYLE, certaintyOf } from "../domain/confidence";
import { ROOT_KEY } from "../domain/graph";
import { fetchNode, keys } from "./api";
import { CertaintyDot, CertaintyLine } from "./certainty";
import { Icon } from "./icons";
import { SourceBadge } from "./source-badge";

/**
 * One fact in full: how sure, what it says, the exact words it stands on
 * (each tied to its document) and what it links to. Loads on open.
 */
export function FactSheet({
  clientId,
  clientName,
  nodeKey,
  nodes,
  sources,
  onSelect,
  onOpenSource,
  onClose,
}: {
  clientId: string;
  clientName: string;
  nodeKey: string;
  nodes: NodeLite[];
  sources: SourceSummary[];
  onSelect: (key: string) => void;
  onOpenSource: (sourceId: string, quote?: string) => void;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: keys.node(clientId, nodeKey),
    queryFn: ({ signal }) => fetchNode(clientId, nodeKey, { signal }),
    staleTime: 30_000,
  });
  const lite = nodes.find((node) => node.key === nodeKey);
  const node = query.data;
  const label = (key: string) =>
    key === ROOT_KEY
      ? clientName
      : (nodes.find((item) => item.key === key)?.label ??
        key.split(":")[1]?.replace(/-/g, " ") ??
        key);
  const confidence = node?.confidence ?? lite?.confidence ?? 0.5;
  const category = node?.category ?? lite?.category ?? "profile.personal";
  const tone = toneOf(category);
  const { branch, leaf } = categoryLabel(category);
  const isRoot = nodeKey === ROOT_KEY;
  const sourceOf = new Map(sources.map((source) => [source.id, source]));
  const attributes = Object.entries(node?.attributes ?? lite?.attributes ?? {});
  const level = certaintyOf(confidence);

  return (
    <motion.aside
      key={nodeKey}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      aria-label={`${lite?.label ?? nodeKey} details`}
      className="outline-box flex max-h-full flex-col overflow-hidden rounded-sm bg-paper shadow-hard-md"
    >
      <header className="flex items-start gap-3 border-ink border-b-2 p-4">
        <span
          aria-hidden="true"
          className="mt-1.5 size-3 shrink-0 rounded-full"
          style={{ background: tone }}
        />
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[0.65rem] text-ink-muted">
            {isRoot ? "Client" : `${branch} › ${leaf}`}
          </p>
          <h3 className="mt-0.5 font-mono text-lg leading-tight font-bold uppercase [overflow-wrap:anywhere]">
            {isRoot ? clientName : (node?.label ?? lite?.label ?? nodeKey)}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="outline-box press grid size-8 shrink-0 place-items-center rounded-sm bg-paper"
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="cm-scroll flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        {!isRoot ? (
          <div className="flex items-center gap-3">
            <div
              className="relative h-2 flex-1 overflow-hidden rounded-sm border border-ink bg-marble"
              aria-hidden="true"
            >
              <motion.div
                className="h-full"
                style={{ background: CERTAINTY_STYLE[level].color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(confidence * 100)}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            </div>
            <span
              className="flex items-center gap-1.5 font-mono text-xs font-bold"
              style={{ color: CERTAINTY_STYLE[level].color }}
            >
              <CertaintyDot confidence={confidence} />
              {Math.round(confidence * 100)}%
            </span>
          </div>
        ) : null}

        {(node?.summary ?? lite?.summary) ? (
          <p className="text-[0.95rem] leading-snug">
            {node?.summary ?? lite?.summary}
          </p>
        ) : null}

        {attributes.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {attributes.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-ink-muted capitalize">
                  {name.replace(/_/g, " ")}
                </dt>
                <dd className="font-medium [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {query.isLoading ? (
          <div className="space-y-2">
            <div className="cm-shimmer h-14 rounded-sm" />
            <div className="cm-shimmer h-14 rounded-sm" />
          </div>
        ) : null}

        {node && node.evidence.length > 0 ? (
          <section aria-label="Sources">
            <ul className="space-y-2">
              {node.evidence.slice(0, 8).map((item, index) => {
                const source = sourceOf.get(item.sourceId);
                return (
                  <motion.li
                    key={`${item.sourceId}-${index}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenSource(item.sourceId, item.quote)}
                      className="group block w-full rounded-sm border-brass border-l-[3px] bg-marble/70 px-3 py-2 text-left hover:bg-morning-haze/60"
                    >
                      {item.quote ? (
                        <q className="block leading-snug italic">
                          {item.quote}
                        </q>
                      ) : null}
                      {source ? (
                        <span className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted group-hover:text-federal-blue">
                          <SourceBadge kind={source.kind} />
                          <span className="truncate">{source.name}</span>
                          <Icon name="chevron" className="ml-auto size-3" />
                        </span>
                      ) : null}
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          </section>
        ) : node && !isRoot ? (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Icon name="spark" className="size-3.5 text-brass" />
            Inferred: no quote stands behind it.
          </p>
        ) : null}

        {node && node.links.length > 0 ? (
          <section aria-label="Relations">
            <ul className="divide-y divide-ink/10">
              {node.links.map((link) => {
                const outgoing = link.from === nodeKey;
                const other = outgoing ? link.to : link.from;
                const otherNode = nodes.find((item) => item.key === other);
                return (
                  <li key={`${link.from}-${link.relation}-${link.to}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(other)}
                      className="group flex w-full items-center gap-2.5 py-2 text-left"
                    >
                      <CertaintyLine confidence={link.confidence} />
                      <span className="min-w-0 flex-1 leading-snug">
                        <span className="text-ink-muted">
                          {outgoing
                            ? link.label
                            : `${label(other)} ${link.label}`}
                        </span>{" "}
                        <span className="font-semibold group-hover:text-federal-blue group-hover:underline">
                          {outgoing ? label(other) : "this"}
                        </span>
                      </span>
                      {link.evidence.length > 0 ? (
                        <span
                          className="flex items-center gap-0.5 font-mono text-[0.65rem] text-stone"
                          title={`${link.evidence.length} quote${link.evidence.length === 1 ? "" : "s"}`}
                        >
                          <Icon name="doc" className="size-3" />
                          {link.evidence.length}
                        </span>
                      ) : null}
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          background: toneOf(
                            otherNode?.category ?? "profile.personal",
                          ),
                        }}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </motion.aside>
  );
}
