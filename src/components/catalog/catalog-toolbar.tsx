"use client";

import { useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { catalog, demoShelves } from "@/content/landing";
import { type CatalogFilter, SORTS, type SortKey } from "./catalog-query";

export type CatalogView = "cards" | "index";

const FILTERS: { id: CatalogFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...demoShelves.map((shelf) => ({ id: shelf.id, label: shelf.label })),
  { id: "new", label: "New" },
];

const square =
  "flex size-10 shrink-0 items-center justify-center rounded-sm border-2 border-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue";

/**
 * The catalog's controls in one slim bar that rides along under the site
 * header: search, the shelves with their counts, sort, the view and the
 * dice. On a phone, once it's riding along, the shelves fold away until
 * you reach for the bar.
 */
export function CatalogToolbar({
  inputRef,
  query,
  onQuery,
  filter,
  onFilter,
  counts,
  sort,
  onSort,
  view,
  onView,
  shown,
  total,
  onSurprise,
  announce,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  filter: CatalogFilter;
  onFilter: (filter: CatalogFilter) => void;
  counts: Record<CatalogFilter, number>;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  view: CatalogView;
  onView: (view: CatalogView) => void;
  shown: number;
  total: number;
  onSurprise: () => void;
  /** Said once in place of the count, such as which demo "Surprise me" picked. */
  announce?: string | null;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useTypedHints(inputRef, query === "");

  // The bar is riding along once the line just above it has gone under the header.
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 120),
      { rootMargin: "-76px 0px 0px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      <search
        aria-label="Search and filter the demos"
        data-stuck={stuck}
        className="catalog-bar sticky top-[4.125rem] block z-10 -mx-2 mb-10 bg-marble px-2 pt-2 pb-1 lg:mb-12"
      >
        <div className="catalog-bar-box outline-box flex flex-wrap items-center gap-2 bg-paper p-1.5 shadow-hard-md sm:flex-nowrap">
          <div className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-sm border-2 border-ink bg-marble px-2.5 focus-within:bg-paper focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-federal-blue sm:w-44 sm:flex-none">
            <Icon name="search" size={18} className="shrink-0" />
            <input
              aria-label="Search the demos"
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  onQuery("");
                }
              }}
              placeholder="Search the demos"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  onQuery("");
                  inputRef.current?.focus();
                }}
                className="eyebrow shrink-0 text-[0.625rem] font-bold text-ink-muted hover:text-ink"
              >
                Clear
              </button>
            ) : (
              <kbd className="hidden shrink-0 rounded-sm border border-ink/40 px-1.5 font-mono text-[0.6875rem] text-ink-muted sm:block">
                /
              </kbd>
            )}
          </div>

          {/* The All chip shows the count; this tells a screen reader when it changes. */}
          <output aria-live="polite" className="sr-only">
            {announce ?? `${shown} of ${total} demos shown`}
          </output>

          <fieldset className="catalog-chips order-last flex min-w-0 basis-full gap-1.5 overflow-x-auto sm:order-none sm:flex-1 sm:basis-auto">
            <legend className="sr-only">Shelves</legend>
            {FILTERS.map((item) => {
              const active = item.id === filter;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFilter(active ? "all" : item.id)}
                  className={`catalog-chip flex h-10 shrink-0 items-center gap-1.5 rounded-sm border-2 px-2 font-mono text-[0.6875rem] font-bold tracking-[0.04em] uppercase transition-[background-color,color,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue ${active ? "border-ink bg-ink text-paper" : "border-transparent hover:border-ink"} ${counts[item.id] === 0 && !active ? "opacity-45" : ""}`}
                >
                  {item.label}
                  <span
                    className={`rounded-sm px-1 text-[0.625rem] tabular-nums ${active ? "bg-brass text-ink" : "bg-limestone"}`}
                  >
                    {counts[item.id]}
                  </span>
                </button>
              );
            })}
          </fieldset>

          <label className="hidden h-10 shrink-0 items-center md:flex">
            <span className="sr-only">Sort</span>
            <select
              value={sort}
              onChange={(event) => onSort(event.target.value as SortKey)}
              className="h-10 rounded-sm border-2 border-ink bg-paper px-2 font-mono text-xs font-bold tracking-[0.06em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
            >
              {SORTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex shrink-0 overflow-hidden rounded-sm">
            <legend className="sr-only">View</legend>
            <button
              type="button"
              aria-pressed={view === "cards"}
              aria-label="Card view"
              title="Card view"
              onClick={() => onView("cards")}
              className={`${square} rounded-r-none ${view === "cards" ? "bg-ink text-paper" : "bg-paper hover:bg-morning-haze"}`}
            >
              <Icon name="grid" size={16} />
            </button>
            <button
              type="button"
              aria-pressed={view === "index"}
              aria-label="List view"
              title="List view"
              onClick={() => onView("index")}
              className={`${square} -ml-0.5 rounded-l-none ${view === "index" ? "bg-ink text-paper" : "bg-paper hover:bg-morning-haze"}`}
            >
              <Icon name="list" size={16} />
            </button>
          </fieldset>

          <button
            type="button"
            onClick={onSurprise}
            disabled={shown === 0}
            title={catalog.surprise}
            className={`${square} catalog-dice gap-2 bg-brass px-0 hover:bg-[#e4b968] disabled:opacity-40 2xl:w-auto 2xl:px-3`}
          >
            <Icon name="dice" size={18} className="catalog-dice-icon" />
            <span className="sr-only 2xl:not-sr-only 2xl:eyebrow 2xl:font-bold">
              {catalog.surprise}
            </span>
          </button>
        </div>
      </search>
      <div aria-hidden="true" className="catalog-bar-spacer" />
    </>
  );
}

/**
 * While the box is empty and not in use, its placeholder types out
 * searches to try. Written to the input directly, so it never re-renders.
 */
function useTypedHints(
  inputRef: RefObject<HTMLInputElement | null>,
  enabled: boolean,
) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !enabled || reduce) return;
    let timer = 0;
    let hint = 0;
    let typed = 0;
    let deleting = false;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(input);
    const tick = () => {
      let wait = 90;
      if (!visible || document.activeElement === input) {
        input.placeholder = "Search the demos";
        wait = 600;
      } else {
        const word = catalog.searchHints[hint];
        if (!deleting && typed < word.length) typed += 1;
        else if (!deleting) {
          deleting = true;
          wait = 1700;
        } else if (typed > 0) {
          typed -= 1;
          wait = 40;
        } else {
          deleting = false;
          hint = (hint + 1) % catalog.searchHints.length;
          wait = 350;
        }
        input.placeholder = `Try “${word.slice(0, typed)}”`;
      }
      timer = window.setTimeout(tick, wait);
    };
    timer = window.setTimeout(tick, 900);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      input.placeholder = "Search the demos";
    };
  }, [inputRef, enabled, reduce]);
}
