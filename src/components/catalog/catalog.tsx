"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollIn } from "@/components/motion/scroll-in";
import { catalog, demoShelves } from "@/content/landing";
import { CatalogCard, type Spot } from "./catalog-card";
import { CatalogIndex } from "./catalog-index";
import {
  type CatalogFilter,
  cardSpans,
  catalogEntries,
  countByFilter,
  filterEntries,
  rouletteSchedule,
  type SortKey,
  searchTerms,
  sortEntries,
} from "./catalog-query";
import { CatalogToolbar, type CatalogView } from "./catalog-toolbar";
import "./catalog.css";

const ENTRIES = catalogEntries();

/** How long a "Surprise me" pick stays in the spotlight, in ms. */
const SPOTLIGHT_MS = 9000;

const md = { 1: "", 2: "md:col-span-2" } as const;
const lg = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
} as const;

/**
 * Every live demo, filed as index cards. Search, shelves, sort and two views
 * share one slim bar; "Surprise me" runs a light over the cards and stamps
 * one. Previews hold still until you look at them.
 */
export function Catalog({ heading }: { heading: ReactNode }) {
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [sort, setSort] = useState<SortKey>("tour");
  const [view, setView] = useState<CatalogView>("cards");
  const [spot, setSpot] = useState<{ slug: string; picked: boolean } | null>(
    null,
  );
  const timers = useRef<number[]>([]);
  const lastPick = useRef<string | null>(null);
  /** When the pick landed: the page scrolls cards under a still pointer for a moment after. */
  const landedAt = useRef(0);

  const deferred = useDeferredValue(query);
  const terms = useMemo(() => searchTerms(deferred), [deferred]);
  const shown = useMemo(
    () => sortEntries(filterEntries(ENTRIES, terms, filter), sort),
    [terms, filter, sort],
  );
  const counts = useMemo(() => countByFilter(ENTRIES, terms), [terms]);
  const spans = cardSpans(shown.length);

  const stopSurprise = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setSpot(null);
  }, []);

  // A new search, shelf or sort puts the spotlight away. (Not the view:
  // "Surprise me" switches to the cards itself.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on these changes on purpose
  useEffect(stopSurprise, [terms, filter, sort, stopSurprise]);
  // The list has no spotlight; leaving the cards ends one.
  useEffect(() => {
    if (view === "index") stopSurprise();
  }, [view, stopSurprise]);
  useEffect(() => stopSurprise, [stopSurprise]);

  // "/" jumps to the search box from anywhere on the page; Escape drops the spotlight.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") stopSurprise();
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopSurprise]);

  function surprise() {
    stopSurprise();
    if (!shown.length) return;
    const slugs = shown.map((entry) => entry.demo.slug);
    const pool =
      slugs.length > 1
        ? slugs.filter((slug) => slug !== lastPick.current)
        : slugs;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastPick.current = pick;
    const later = (fn: () => void, ms: number) =>
      timers.current.push(window.setTimeout(fn, ms));
    const land = () => {
      landedAt.current = performance.now();
      setSpot({ slug: pick, picked: true });
      const card = document.getElementById(`catalog-${pick}`);
      // Focus follows the pick, so a keyboard or screen reader lands on it too.
      card
        ?.querySelector<HTMLAnchorElement>(".catalog-link")
        ?.focus({ preventScroll: true });
      card?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "center",
      });
      later(() => setSpot(null), SPOTLIGHT_MS);
    };
    if (view !== "cards") setView("cards");
    if (reduce) {
      later(land, 0);
      return;
    }
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // A light runs over the cards and stops on the pick.
    const stops = rouletteSchedule(
      slugs,
      Math.floor(Math.random() * slugs.length),
      pick,
    );
    for (const stop of stops)
      later(() => setSpot({ slug: stop.slug, picked: false }), stop.at);
    later(land, (stops.at(-1)?.at ?? 0) + 180);
  }

  function spotFor(slug: string): Spot | undefined {
    if (!spot) return undefined;
    if (spot.slug === slug) return spot.picked ? "picked" : "roll";
    return spot.picked ? "dim" : undefined;
  }

  function clearAll() {
    setQuery("");
    setFilter("all");
    inputRef.current?.focus();
  }

  return (
    <div>
      <div className="mb-12 flex flex-col gap-10 lg:mb-14 lg:flex-row lg:items-end lg:justify-between">
        {heading}
        <Drawer onPull={surprise} />
      </div>
      <CatalogToolbar
        inputRef={inputRef}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        sort={sort}
        onSort={setSort}
        view={view}
        onView={setView}
        shown={shown.length}
        total={ENTRIES.length}
        onSurprise={surprise}
        announce={
          spot?.picked
            ? `${catalog.picked}: ${ENTRIES.find((entry) => entry.demo.slug === spot.slug)?.demo.title}`
            : null
        }
      />

      <div ref={gridRef} className="scroll-mt-40">
        {shown.length === 0 ? (
          <Empty query={query} filter={filter} onClear={clearAll} />
        ) : view === "index" ? (
          <CatalogIndex entries={shown} terms={terms} />
        ) : (
          <ol className="grid grid-cols-1 gap-x-6 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((entry, index) => (
                <motion.li
                  key={entry.demo.slug}
                  layout={!reduce}
                  initial={
                    reduce
                      ? false
                      : { opacity: 0, scale: 0.9, y: -24, rotate: 3 }
                  }
                  animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
                  exit={
                    reduce
                      ? undefined
                      : {
                          opacity: 0,
                          scale: 0.86,
                          y: 40,
                          rotate: index % 2 ? 6 : -6,
                          transition: { duration: 0.22 },
                        }
                  }
                  transition={{ type: "spring", stiffness: 240, damping: 26 }}
                  className={`min-w-0 ${md[spans[index].md]} ${lg[spans[index].lg]}`}
                >
                  <ScrollIn lean={index % 2 === 0 ? -3 : 3} className="h-full">
                    <CatalogCard
                      entry={entry}
                      wide={{
                        md: spans[index].md === 2,
                        lg: spans[index].lg > 1,
                      }}
                      terms={terms}
                      spot={spotFor(entry.demo.slug)}
                      onTag={(tag) => {
                        setQuery(tag);
                        inputRef.current?.scrollIntoView({ block: "nearest" });
                      }}
                      onHover={(slug) => {
                        const settled =
                          performance.now() - landedAt.current > 1500;
                        if (spot?.picked && spot.slug !== slug && settled)
                          stopSurprise();
                      }}
                    />
                  </ScrollIn>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </div>
  );
}

/** A card-catalog drawer front by the heading. Pull it and it picks a demo for you. */
function Drawer({ onPull }: { onPull: () => void }) {
  const fresh = ENTRIES.filter((entry) => entry.demo.marks?.includes("New"));
  const last = ENTRIES[ENTRIES.length - 1]?.number ?? "01";
  return (
    <button
      type="button"
      onClick={onPull}
      aria-label={catalog.drawer}
      title={catalog.drawer}
      className="catalog-drawer group relative hidden w-72 shrink-0 pt-10 text-left focus-visible:outline-none lg:block"
    >
      {/* Cards that peek out of the drawer when it's pulled. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-6 top-0 h-16 overflow-hidden"
      >
        {[0, 1, 2].map((card) => (
          <span
            key={card}
            className="catalog-drawer-card absolute top-3 h-14 w-[42%] border-2 border-ink bg-paper"
            style={
              {
                left: `${card * 29}%`,
                "--peek": `${card === 1 ? -4 : 10}%`,
                transitionDelay: `${card * 45}ms`,
              } as React.CSSProperties
            }
          >
            <span className="mx-2 mt-2 block h-1 bg-seal-red/50" />
            <span className="mx-2 mt-1.5 block h-1 bg-ink/15" />
          </span>
        ))}
      </span>
      <span className="catalog-drawer-front outline-box relative block bg-limestone p-4 shadow-hard-md group-focus-visible:outline-2 group-focus-visible:outline-offset-4 group-focus-visible:outline-federal-blue">
        <span className="mx-auto block w-40 border-2 border-oak bg-paper px-3 py-1.5 text-center font-mono text-xs font-bold tracking-[0.12em] uppercase shadow-[inset_0_0_0_2px_var(--color-brass)]">
          Demos 01–{last}
        </span>
        <span
          aria-hidden="true"
          className="mx-auto mt-3 block h-3 w-16 rounded-b-sm border-2 border-ink border-t-0 bg-brass"
        />
        <span className="eyebrow mt-3 flex items-center justify-between gap-3 text-[0.625rem] whitespace-nowrap text-ink-muted">
          <span>
            {ENTRIES.length} live · {fresh.length} new
          </span>
          <span className="font-bold text-ink">{catalog.drawer} ↓</span>
        </span>
      </span>
    </button>
  );
}

function Empty({
  query,
  filter,
  onClear,
}: {
  query: string;
  filter: CatalogFilter;
  onClear: () => void;
}) {
  const shelf = demoShelves.find((item) => item.id === filter);
  const where = query.trim()
    ? `“${query.trim()}”`
    : (shelf?.label ?? (filter === "new" ? "New" : ""));
  return (
    <div className="outline-box relative overflow-hidden bg-paper px-6 py-14 text-center shadow-hard-md">
      <span
        aria-hidden="true"
        className="catalog-stamp mx-auto mb-6 inline-block rounded-sm border-[3px] border-seal-red px-3 py-1 font-mono text-lg font-bold tracking-[0.16em] text-seal-red uppercase"
      >
        Not on file
      </span>
      <p className="font-mono text-xl font-bold uppercase">
        {catalog.empty} {where}
        {query.trim() && filter !== "all" ? ` on ${shelf?.label ?? "New"}` : ""}
        .
      </p>
      <p className="mt-2 text-ink-muted">
        Try fewer words, or one of the hints the search box types.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="outline-box press eyebrow mt-6 rounded-sm bg-paper px-4 py-2 font-bold"
      >
        Show every demo
      </button>
    </div>
  );
}
