"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { PassageHit } from "../../domain/knowledge";
import { formatDocumentDate } from "../../domain/knowledge/dates";
import { api, keys, messageOf } from "../api";
import {
  Badge,
  Button,
  Empty,
  ErrorNote,
  inputClass,
  Loading,
  Panel,
} from "../ui";
import { KIND_LABEL } from "./format";

const EXAMPLES = [
  "how much can I withdraw for a property",
  "when are contributions due",
  "documents for an overseas transfer",
  "HBT-PEN-01",
];

const SNIPPET = 320;

/**
 * Search over Passages by words and meaning together. Each hit shows its fused
 * score and which of the two searches found it, so a person can see the
 * hybrid at work: a form number is found by its words, a paraphrase by its
 * meaning.
 */
export function SearchPanel({
  onOpenSource,
  onOpenConflicts,
}: {
  onOpenSource: (sourceId: string) => void;
  onOpenConflicts: () => void;
}) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const search = useQuery({
    queryKey: keys.search({ q: query, limit: 8 }),
    queryFn: () => api.knowledge.search({ q: query, limit: 8 }),
    enabled: query.length > 0,
    staleTime: 30_000,
  });

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setText(trimmed);
    setQuery(trimmed);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <Panel
        eyebrow="Hybrid search"
        title="Search the Knowledge base"
        bodyClassName="space-y-3 p-3"
      >
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(text);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Search Passages
          </label>
          <input
            id={inputId}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Ask in your own words, or type a form number"
            maxLength={500}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <Button
            type="submit"
            variant="primary"
            pending={search.isFetching && query.length > 0}
            pendingLabel="Searching…"
            disabled={!text.trim()}
          >
            Search
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => submit(example)}
              className="rounded-sm border border-ink/20 bg-paper px-2 py-1 text-xs text-ink-muted hover:border-ink/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-federal-blue"
            >
              {example}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          Meaning and words are searched separately and fused by rank. A hit
          shows which one found it. Superseded Passages are left out.
        </p>
      </Panel>

      {query.length === 0 ? null : search.isPending ? (
        <Loading rows={3} />
      ) : search.isError ? (
        <ErrorNote onRetry={() => void search.refetch()}>
          {messageOf(search.error)}
        </ErrorNote>
      ) : search.data.length === 0 ? (
        <Empty title="Nothing found">
          No filed Passage matches. Add a Source, or try other words.
        </Empty>
      ) : (
        <ol className="space-y-2" aria-label="Results">
          {search.data.map((hit, index) => (
            <HitCard
              key={hit.passageId}
              rank={index + 1}
              hit={hit}
              top={search.data[0]?.score ?? hit.score}
              onOpenSource={onOpenSource}
              onOpenConflicts={onOpenConflicts}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function HitCard({
  rank,
  hit,
  top,
  onOpenSource,
  onOpenConflicts,
}: {
  rank: number;
  hit: PassageHit;
  top: number;
  onOpenSource: (sourceId: string) => void;
  onOpenConflicts: () => void;
}) {
  const [open, setOpen] = useState(false);
  const long = hit.body.length > SNIPPET;
  const width = top > 0 ? Math.max(4, Math.round((hit.score / top) * 100)) : 4;
  return (
    <li className="rounded-sm border border-ink/15 bg-paper px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs text-ink-muted">#{rank}</span>
        <button
          type="button"
          onClick={() => onOpenSource(hit.sourceId)}
          className="min-w-0 flex-1 text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-federal-blue"
        >
          {hit.sourceTitle}
        </button>
        <Badge>{KIND_LABEL[hit.sourceKind]}</Badge>
        {hit.conflictOpen ? (
          <button
            type="button"
            onClick={onOpenConflicts}
            title="This Passage is part of an open Conflict. An answer that cites it must say so."
            className="rounded-sm focus-visible:outline-2 focus-visible:outline-federal-blue"
          >
            <Badge tone="amber">Conflict open</Badge>
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">
        {formatDocumentDate(hit.documentDate)}
        {hit.heading ? ` · ${hit.heading}` : ""}
      </p>
      <p className="mt-1.5 text-sm break-words whitespace-pre-wrap">
        {open || !long ? hit.body : `${hit.body.slice(0, SNIPPET).trimEnd()}…`}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-1 text-xs font-medium text-federal-blue underline underline-offset-2"
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div
          className="h-1.5 w-24 shrink-0 rounded-full bg-marble"
          role="img"
          aria-label={`Score ${hit.score.toFixed(4)}`}
        >
          <div
            className="h-full rounded-full bg-federal-blue"
            style={{ width: `${width}%` }}
          />
        </div>
        <span className="font-mono text-xs">{hit.score.toFixed(4)}</span>
        <Badge
          tone={hit.semantic !== null ? "blue" : "neutral"}
          title="Cosine similarity of the Passage's embedding to the query"
        >
          {hit.semantic !== null
            ? `meaning ${hit.semantic.toFixed(2)}`
            : "no meaning match"}
        </Badge>
        <Badge
          tone={hit.lexical !== null ? "green" : "neutral"}
          title="Full-text rank of the Passage's words against the query"
        >
          {hit.lexical !== null
            ? `words ${hit.lexical.toFixed(2)}`
            : "no word match"}
        </Badge>
      </div>
    </li>
  );
}
