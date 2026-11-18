"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toneOf } from "../domain/categories";
import { CERTAINTY_STYLE, certaintyOf } from "../domain/confidence";
import type { ClientSummary, SourceFull } from "../server/service";
import { fetchSource, keys } from "./api";
import { CertaintyDot } from "./certainty";
import { Icon } from "./icons";
import { DocumentSkeleton } from "./skeletons";
import { SourceBadge } from "./source-badge";

/**
 * The documents a client's facts were read from. Open one to read it with
 * every quote the graph stands on marked in place, and the facts beside it.
 */
export function DocumentsView({
  client,
  openId,
  quote,
  onOpen,
  onFact,
}: {
  client: ClientSummary;
  openId: string | null;
  quote: string | null;
  onOpen: (sourceId: string | null, quote?: string) => void;
  onFact: (key: string) => void;
}) {
  const queryClient = useQueryClient();
  // A Document starts loading when the pointer or focus reaches it.
  const prefetch = (sourceId: string) =>
    void queryClient.prefetchQuery(sourceQuery(client.id, sourceId));
  const most = Math.max(1, ...client.sources.map((source) => source.facts));
  const selected = openId ?? client.sources[0]?.id ?? null;

  if (client.sources.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-ink-muted">
        No documents yet.
      </p>
    );
  }
  return (
    <div className="grid h-full min-h-0 md:grid-cols-[15rem_minmax(0,1fr)]">
      <ul className="cm-scroll max-h-48 overflow-y-auto border-ink border-b-2 p-2 md:max-h-none md:border-r-2 md:border-b-0">
        {client.sources.map((source, index) => (
          <motion.li
            key={source.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
          >
            <button
              type="button"
              onClick={() => onOpen(source.id)}
              onPointerEnter={() => prefetch(source.id)}
              onFocus={() => prefetch(source.id)}
              aria-current={selected === source.id}
              className={`block w-full rounded-sm border-2 px-2.5 py-2 text-left ${selected === source.id ? "border-ink bg-paper shadow-hard-sm" : "border-transparent hover:border-ink/20 hover:bg-paper/70"}`}
            >
              <span className="flex items-center gap-2">
                <SourceBadge kind={source.kind} />
                <span className="truncate text-sm font-medium">
                  {source.name}
                </span>
              </span>
              <span
                className="mt-1.5 flex items-center gap-2"
                title={`Backs ${source.facts} facts`}
              >
                <span className="h-1.5 flex-1 overflow-hidden border border-ink/30 bg-limestone/60">
                  <span
                    className="block h-full bg-federal-blue"
                    style={{ width: `${(source.facts / most) * 100}%` }}
                  />
                </span>
                <span className="font-mono text-[0.65rem] text-stone tabular-nums">
                  {source.facts}
                </span>
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
      {selected ? (
        <DocumentReader
          key={selected}
          clientId={client.id}
          sourceId={selected}
          quote={quote}
          onFact={onFact}
        />
      ) : null}
    </div>
  );
}

export const sourceQuery = (clientId: string, sourceId: string) => ({
  queryKey: keys.source(clientId, sourceId),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    fetchSource(clientId, sourceId, { signal }),
  staleTime: 60_000,
});

type Range = { start: number; end: number; index: number };

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

/** Where each quote sits in the text: exact first, then ignoring case and spacing. */
function locate(text: string, quotes: string[]): Range[] {
  const lower = text.toLowerCase();
  const ranges: Range[] = [];
  quotes.forEach((quote, index) => {
    const needle = quote.trim().toLowerCase();
    if (needle.length < 4) return;
    let at = lower.indexOf(needle);
    if (at < 0) {
      // Collapse runs of spaces in the needle and match against a regex.
      const pattern = squash(needle)
        .split(" ")
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      const match = new RegExp(pattern).exec(lower);
      if (!match) return;
      at = match.index;
      ranges.push({ start: at, end: at + match[0].length, index });
      return;
    }
    ranges.push({ start: at, end: at + needle.length, index });
  });
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start < last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function DocumentReader({
  clientId,
  sourceId,
  quote,
  onFact,
}: {
  clientId: string;
  sourceId: string;
  quote: string | null;
  onFact: (key: string) => void;
}) {
  const query = useQuery(sourceQuery(clientId, sourceId));
  const source = query.data;
  const [active, setActive] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const ranges = useMemo(
    () =>
      source?.text
        ? locate(
            source.text,
            source.backing.map((fact) => fact.quote),
          )
        : [],
    [source],
  );

  // Arriving from a fact: jump to its quote.
  useEffect(() => {
    if (!source || !quote) return;
    const index = source.backing.findIndex((fact) => fact.quote === quote);
    if (index >= 0) setActive(index);
  }, [source, quote]);

  useEffect(() => {
    if (active === null) return;
    const range = ranges.find((item) => item.index === active);
    const mark = body.current?.querySelector(
      `[data-range="${range?.start ?? -1}"]`,
    );
    mark?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active, ranges]);

  if (query.isError) {
    return (
      <p role="alert" className="p-8 text-center text-sm text-ink-muted">
        {query.error.message === "not-found"
          ? "This document is gone."
          : "This document didn't load. Try again."}
      </p>
    );
  }
  if (!source) return <DocumentSkeleton />;

  return (
    <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <article className="cm-scroll min-h-0 overflow-y-auto p-4 sm:p-6">
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <SourceBadge kind={source.kind} />
          <h3 className="min-w-0 flex-1 truncate font-mono font-bold uppercase">
            {source.name}
          </h3>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="outline-box press eyebrow flex items-center gap-1 rounded-sm bg-paper px-2.5 py-1"
            >
              <Icon name="external" className="size-3" />
              Original
            </a>
          ) : null}
        </header>
        {source.kind === "image" && source.url ? (
          // biome-ignore lint/performance/noImgElement: a signed Storage URL that changes hourly
          <img
            src={source.url}
            alt={source.name}
            className="outline-box max-h-[60vh] rounded-sm shadow-hard-sm"
          />
        ) : source.text ? (
          <div
            ref={body}
            className="font-serif text-[0.95rem] leading-relaxed whitespace-pre-wrap"
          >
            <Marked
              text={source.text}
              ranges={ranges}
              source={source}
              active={active}
            />
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            This document had no text to read.
          </p>
        )}
      </article>
      <aside
        aria-label="Facts from this document"
        className="cm-scroll max-h-64 min-h-0 overflow-y-auto border-ink border-t-2 bg-marble/50 p-2 lg:max-h-none lg:border-t-0 lg:border-l-2"
      >
        <ul className="space-y-0.5">
          {source.backing.map((fact, index) => (
            <li key={`${fact.key}-${index}`}>
              <div
                className={`flex items-start gap-2 rounded-sm border-2 px-2 py-1.5 ${active === index ? "border-ink bg-paper shadow-hard-sm" : "border-transparent hover:bg-paper/70"}`}
              >
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  className="mt-1"
                  aria-label="Show the quote"
                >
                  <CertaintyDot confidence={fact.confidence} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    fact.key ? onFact(fact.key) : setActive(index)
                  }
                  onMouseEnter={() => setActive(index)}
                  className="min-w-0 flex-1 text-left text-sm leading-snug hover:text-federal-blue"
                >
                  <span
                    aria-hidden="true"
                    className="mr-1.5 inline-block size-2 rounded-full align-middle"
                    style={{
                      background: toneOf(fact.category ?? "profile.personal"),
                    }}
                  />
                  {fact.label}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Marked({
  text,
  ranges,
  source,
  active,
}: {
  text: string;
  ranges: Range[];
  source: SourceFull;
  active: number | null;
}) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at)
      parts.push(
        <Fragment key={`t-${at}`}>{text.slice(at, range.start)}</Fragment>,
      );
    const fact = source.backing[range.index];
    const level = certaintyOf(fact?.confidence ?? 0.5);
    const isActive = active === range.index;
    parts.push(
      <mark
        key={`m-${range.start}`}
        data-range={range.start}
        title={fact?.label}
        className={`rounded-[2px] px-0.5 text-ink transition-[background,box-shadow] duration-300 ${isActive ? "cm-flash" : ""}`}
        style={{
          background: isActive ? "#d9a84e88" : "#d9a84e33",
          boxShadow: `inset 0 -2px 0 ${CERTAINTY_STYLE[level].color}`,
        }}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    at = range.end;
  }
  if (at < text.length)
    parts.push(<Fragment key={`t-${at}`}>{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}
