"use client";

import { useEffect } from "react";
import type { ConflictView, Resolution } from "../../domain/knowledge";
import { scrollWithin } from "../scroll";
import { Empty, Tabs } from "../ui";
import { ConflictCard } from "./conflict-card";

export type ConflictFilter = "open" | "resolved" | "all";

/** The Workspace's Conflicts, open first, with a filter and the deep-linked one marked. */
export function ConflictsPanel({
  conflicts,
  filter,
  onFilter,
  focusId,
  canResolve,
  onResolve,
  onOpenSource,
}: {
  conflicts: ConflictView[];
  filter: ConflictFilter;
  onFilter: (filter: ConflictFilter) => void;
  focusId: string | null;
  canResolve: boolean;
  onResolve: (conflictId: string, resolution: Resolution) => Promise<void>;
  onOpenSource: (sourceId: string) => void;
}) {
  const open = conflicts.filter((conflict) => conflict.status === "open");
  const settled = conflicts.filter(
    (conflict) => conflict.status === "resolved",
  );
  const shown =
    filter === "open" ? open : filter === "resolved" ? settled : conflicts;

  // A deep link to a Conflict opens on the filter that holds it, and scrolls to it.
  useEffect(() => {
    if (!focusId) return;
    const found = conflicts.find((conflict) => conflict.id === focusId);
    if (
      found &&
      filter !== "all" &&
      (found.status === "open") !== (filter === "open")
    ) {
      onFilter("all");
      return;
    }
    scrollWithin(document.getElementById(`conflict-${focusId}`), "nearest");
  }, [focusId, conflicts, filter, onFilter]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs<ConflictFilter>
          label="Conflicts to show"
          idPrefix="hx-conflict-filter"
          size="sm"
          value={filter}
          onChange={onFilter}
          tabs={[
            { id: "open", label: `Open (${open.length})` },
            { id: "resolved", label: `Settled (${settled.length})` },
            { id: "all", label: "All" },
          ]}
        />
        <p className="min-w-0 flex-1 text-xs text-ink-muted">
          Found when a Source is added. The Agent proposes; an admin decides.
          Until then both Passages are found by search and an answer that cites
          either says a Conflict is open.
        </p>
      </div>
      {shown.length === 0 ? (
        <Empty title={filter === "open" ? "No open Conflicts" : "Nothing here"}>
          {filter === "open"
            ? "Add the sample Circular 2023-07 to see one: it states new property caps that the older Member Guide does not."
            : "No Conflicts match."}
        </Empty>
      ) : (
        <div className="space-y-3">
          {shown.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              canResolve={canResolve}
              highlighted={conflict.id === focusId}
              onResolve={onResolve}
              onOpenSource={onOpenSource}
            />
          ))}
        </div>
      )}
    </div>
  );
}
