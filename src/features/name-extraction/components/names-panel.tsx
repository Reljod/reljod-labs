"use client";

import { type ReactNode, useState } from "react";
import {
  type EntityType,
  HARD_REASONS,
  type HardReason,
  type MarkStatus,
} from "../domain/contract";
import { cx, fieldClass } from "./ui";

export type NameEntry = {
  name: string;
  type: EntityType;
  status: MarkStatus;
  /** Pages it is on, ascending. */
  pages: number[];
  hard?: boolean;
  hardReason?: HardReason | null;
  /** How Sieve wrote it, when that differs. */
  foundAs?: string | null;
};

export const DOT: Record<MarkStatus, string> = {
  expected: "bg-federal-blue",
  found: "bg-ivy",
  missed: "bg-seal-red",
  extra: "bg-brass",
};

export const HARD_WHY =
  "A hard case: this document only prints the name in a damaged form, such as a bad scan, a name split across a page break, or initials only.";

export function HardChip({ reason }: { reason?: HardReason | null }) {
  const why = reason ? `A hard case. ${HARD_REASONS[reason]}` : HARD_WHY;
  return (
    <span
      title={why}
      className="inline-flex shrink-0 cursor-help items-center rounded-sm border border-oak bg-brass/30 px-1.5 font-mono text-[0.58rem] font-bold tracking-wide text-oak uppercase"
    >
      hard case<span className="sr-only">. {why}</span>
    </span>
  );
}

/** One name as a button that jumps to its next mention. */
export function NameButton({
  entry,
  active,
  onPick,
}: {
  entry: NameEntry;
  active: boolean;
  onPick: (entry: NameEntry) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(entry)}
      aria-pressed={active}
      title={`Jump to the next page with ${entry.name}`}
      className={cx(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue",
        active ? "bg-morning-haze" : "hover:bg-marble",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-2 shrink-0",
          entry.type === "person" ? "rounded-full" : "rounded-[1px]",
          DOT[entry.status],
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{entry.name}</span>
        {entry.foundAs && entry.foundAs !== entry.name ? (
          <span className="block truncate text-xs text-ink-muted">
            written as “{entry.foundAs}”
          </span>
        ) : null}
      </span>
      {entry.hard ? <HardChip reason={entry.hardReason} /> : null}
      <span className="shrink-0 font-mono text-[0.65rem] text-ink-muted tabular-nums">
        {entry.pages.length === 1
          ? `p.${entry.pages[0]}`
          : `${entry.pages.length} pp`}
      </span>
    </button>
  );
}

/** Names grouped people / organizations, each a jump to its pages. */
export function NamesPanel({
  title,
  entries,
  active,
  onPick,
  note,
}: {
  title: string;
  entries: NameEntry[];
  active: string | null;
  onPick: (entry: NameEntry) => void;
  note?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : entries;
  const groups = [
    { type: "person", label: "People" },
    { type: "organization", label: "Organizations" },
  ] as const;
  return (
    <aside className="outline-box flex min-h-0 min-w-0 flex-col rounded-sm bg-paper">
      <div className="flex flex-col gap-2 border-ink/10 border-b p-3">
        <h3 className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-sm font-bold uppercase">{title}</span>
          <span className="font-mono text-xs text-ink-muted">
            {entries.length}
          </span>
        </h3>
        {note ? <p className="text-xs text-ink-muted">{note}</p> : null}
        {entries.length > 12 ? (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a name"
            aria-label="Find a name"
            className={cx(fieldClass, "h-8")}
          />
        ) : null}
      </div>
      <div className="sv-scroll flex max-h-64 flex-col gap-3 overflow-y-auto p-2 lg:max-h-none lg:flex-1">
        {groups.map((group) => {
          const items = shown.filter((entry) => entry.type === group.type);
          if (items.length === 0) return null;
          return (
            <section key={group.type} aria-label={group.label}>
              <h4 className="eyebrow px-2 pb-1 text-[0.6rem] text-ink-muted">
                {group.label} · {items.length}
              </h4>
              <ul>
                {items.map((entry) => (
                  <li key={entry.name}>
                    <NameButton
                      entry={entry}
                      active={active === entry.name}
                      onPick={onPick}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-muted">
            {entries.length === 0 ? "No names yet." : "No name matches."}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
