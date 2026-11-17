"use client";

import { useMemo } from "react";
import type {
  DocumentOverview,
  MarkStatus,
  PageMark,
} from "../domain/contract";
import { HeatStrip } from "./heat-strip";
import { type NameEntry, NamesPanel } from "./names-panel";
import { PaperPage } from "./paper-page";
import { ReaderPane, useJumper } from "./reader-pane";
import { Button } from "./ui";
import { type PageLoader, usePages } from "./use-pages";

/** Names on the pages loaded so far, from one side's marks. */
function namesOf(
  get: (
    page: number,
  ) => { key: PageMark[] | null; run: PageMark[] | null } | undefined,
  total: number,
  side: "key" | "run",
) {
  const byName = new Map<string, NameEntry & { set: Set<number> }>();
  for (let page = 1; page <= total; page++) {
    const marks = get(page)?.[side];
    if (!marks) continue;
    for (const mark of marks) {
      let entry = byName.get(mark.name);
      if (!entry) {
        entry = {
          name: mark.name,
          type: mark.type,
          status: mark.status as MarkStatus,
          pages: [],
          set: new Set(),
        };
        byName.set(mark.name, entry);
      }
      entry.set.add(page);
    }
  }
  return [...byName.values()]
    .map(({ set, ...entry }) => ({
      ...entry,
      pages: [...set].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A Document to read: paper pages fetched as they come near, a heat strip
 * of names per page to jump with, and the names down the side (each a jump
 * to its next mention, which pulses). `side` picks the marks: the answer
 * key's (a demo Document) or a Run's (an Upload's result).
 */
export function DocReader({
  loader,
  total,
  overview,
  side,
  title,
  note,
}: {
  loader: PageLoader;
  total: number;
  /** Names per page and every name with its pages; null while it loads. */
  overview: DocumentOverview | null;
  side: "key" | "run";
  title: string;
  note?: string;
}) {
  const pages = usePages(loader, total);
  const jumper = useJumper();
  // The overview lists every name; until it arrives (or if it fails), the
  // names on the pages loaded so far stand in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` changes when pages land in the cache
  const entries = useMemo<NameEntry[]>(
    () =>
      overview
        ? overview.names.map((item) => ({
            name: item.name,
            type: item.type,
            status: item.status ?? (side === "key" ? "expected" : "found"),
            pages: item.pages,
          }))
        : namesOf(pages.get, total, side),
    [overview, pages.get, pages.version, total, side],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-20 lg:h-[min(80vh,56rem)]">
        <NamesPanel
          title={title}
          entries={entries}
          active={jumper.pulse?.name ?? null}
          onPick={jumper.pick}
          note={note ?? "Click a name to jump to it."}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {pages.error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-seal-red"
          >
            {pages.error}
            <Button
              size="sm"
              onClick={() => void pages.ensure(jumper.range.first)}
            >
              Try again
            </Button>
          </div>
        ) : null}
        <div className="flex h-[min(80vh,56rem)] gap-2 sm:gap-3">
          <ReaderPane
            total={total}
            handle={jumper.pane}
            onNear={(page) => void pages.ensure(page)}
            onRange={jumper.onRange}
            className="min-w-0 flex-1 rounded-md bg-limestone/40 p-2 sm:p-4"
            renderPage={(page) => {
              const item = pages.get(page);
              return (
                <PaperPage
                  number={page}
                  total={total}
                  page={item}
                  marks={item?.[side] ?? null}
                  pulse={jumper.pulse?.page === page ? jumper.pulse : null}
                />
              );
            }}
          />
          <HeatStrip
            total={total}
            density={overview?.density ?? null}
            first={jumper.range.first}
            last={jumper.range.last}
            onJump={jumper.jump}
          />
        </div>
      </div>
    </div>
  );
}
