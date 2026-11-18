import { demoProblems, demoShelves } from "@/content/landing";
import { liveDemos, projects } from "@/content/projects";
import type { Project } from "@/content/types";

export type ShelfId = (typeof demoShelves)[number]["id"];

/** What the catalog is narrowed to: everything, a shelf, or the demos marked New. */
export type CatalogFilter = "all" | "new" | ShelfId;

export type SortKey = "tour" | "newest" | "az";

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "tour", label: "Tour order" },
  { id: "newest", label: "Newest" },
  { id: "az", label: "A to Z" },
];

/** A live demo as the catalog files it. */
export type CatalogEntry = {
  demo: Project;
  /** Its number on the landing page ("01"), which never changes with sort or filter. */
  number: string;
  /** Place in the tour (`liveDemos`). */
  order: number;
  /** Place in `projects`, which only ever grows at the end, so later is newer. */
  added: number;
  problem: string;
  shelves: ShelfId[];
};

export function catalogEntries(demos: Project[] = liveDemos): CatalogEntry[] {
  return demos.map((demo, order) => ({
    demo,
    number: String(order + 1).padStart(2, "0"),
    order,
    added: projects.findIndex((project) => project.slug === demo.slug),
    problem: demoProblems[demo.slug] ?? demo.summary,
    shelves: demoShelves
      .filter((shelf) => (shelf.slugs as readonly string[]).includes(demo.slug))
      .map((shelf) => shelf.id),
  }));
}

/** A query as lowercase words; a demo must contain every one of them. */
export function searchTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(
    0,
    8,
  );
}

/** The words a card shows, which carry their own highlights. */
function shownText(entry: CatalogEntry): string[] {
  const { demo } = entry;
  return [demo.title, demo.sector, entry.problem, demo.summary, ...demo.tags];
}

/** Everything a search looks through, including what the card leaves out. */
function searchedText(entry: CatalogEntry): string[] {
  const { demo } = entry;
  const shelfLabels = demoShelves
    .filter((shelf) => entry.shelves.includes(shelf.id))
    .map((shelf) => shelf.label);
  return [
    ...shownText(entry),
    demo.outcome,
    ...(demo.features ?? []),
    ...(demo.marks ?? []),
    ...shelfLabels,
  ];
}

const has = (texts: string[], term: string) =>
  texts.some((text) => text.toLowerCase().includes(term));

export function matchesTerms(entry: CatalogEntry, terms: string[]): boolean {
  const texts = searchedText(entry);
  return terms.every((term) => has(texts, term));
}

export function inFilter(entry: CatalogEntry, filter: CatalogFilter): boolean {
  if (filter === "all") return true;
  if (filter === "new") return entry.demo.marks?.includes("New") ?? false;
  return entry.shelves.includes(filter);
}

export function filterEntries(
  entries: CatalogEntry[],
  terms: string[],
  filter: CatalogFilter,
): CatalogEntry[] {
  return entries.filter(
    (entry) => inFilter(entry, filter) && matchesTerms(entry, terms),
  );
}

/** How many demos each filter would show for the current search, for the chips' counts. */
export function countByFilter(
  entries: CatalogEntry[],
  terms: string[],
): Record<CatalogFilter, number> {
  const found = entries.filter((entry) => matchesTerms(entry, terms));
  const filters: CatalogFilter[] = [
    "all",
    "new",
    ...demoShelves.map((shelf) => shelf.id),
  ];
  return Object.fromEntries(
    filters.map((filter) => [
      filter,
      found.filter((entry) => inFilter(entry, filter)).length,
    ]),
  ) as Record<CatalogFilter, number>;
}

export function sortEntries(
  entries: CatalogEntry[],
  sort: SortKey,
): CatalogEntry[] {
  const sorted = [...entries];
  if (sort === "newest") sorted.sort((a, b) => b.added - a.added);
  else if (sort === "az")
    sorted.sort((a, b) => a.demo.title.localeCompare(b.demo.title));
  else sorted.sort((a, b) => a.order - b.order);
  return sorted;
}

/**
 * When the search found a demo through words its card doesn't show (a
 * feature, the outcome), the first such line, so the card can say why it's here.
 */
export function hiddenMatch(
  entry: CatalogEntry,
  terms: string[],
): string | null {
  if (!terms.length) return null;
  const shown = shownText(entry);
  const missing = terms.filter((term) => !has(shown, term));
  if (!missing.length) return null;
  const { demo } = entry;
  const hidden = [demo.outcome, ...(demo.features ?? [])];
  return (
    hidden.find((line) =>
      missing.some((term) => line.toLowerCase().includes(term)),
    ) ?? null
  );
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A text cut into runs, each marked as a search hit or not. */
export function highlightParts(
  text: string,
  terms: string[],
): { text: string; hit: boolean }[] {
  const marked = highlightable(terms);
  if (!marked.length) return [{ text, hit: false }];
  const pattern = new RegExp(
    `(${marked
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})`,
    "giu",
  );
  // A split on one capturing group alternates: outside, hit, outside, hit...
  return text
    .split(pattern)
    .map((part, index) => ({ text: part, hit: index % 2 === 1 }))
    .filter((part) => part.text.length > 0);
}

/**
 * How many columns each card takes, so the rows close evenly: on the
 * three-column grid the first (and, if needed, the last) card runs wide; on
 * two columns the first runs wide when the count is odd.
 */
export function cardSpans(count: number): { md: 1 | 2; lg: 1 | 2 | 3 }[] {
  const wide = (3 - (count % 3)) % 3;
  return Array.from({ length: count }, (_, index) => ({
    md: count % 2 === 1 && index === 0 ? 2 : 1,
    lg:
      count === 1
        ? 3
        : (wide >= 1 && index === 0) || (wide >= 2 && index === count - 1)
          ? 2
          : 1,
  }));
}

/**
 * The "Surprise me" roulette: the cards a light visits, in order, and the
 * ms each stop starts at. It goes round twice, slowing like a roulette ball,
 * and always stops on `pick`.
 */
export function rouletteSchedule(
  slugs: string[],
  start: number,
  pick: string,
  firstAt = 380,
): { slug: string; at: number }[] {
  const target = slugs.indexOf(pick);
  if (target < 0 || slugs.length === 0) return [];
  const hops =
    slugs.length * 2 + ((target - start + slugs.length) % slugs.length);
  const stops: { slug: string; at: number }[] = [];
  let at = firstAt;
  for (let hop = 0; hop <= hops; hop += 1) {
    stops.push({ slug: slugs[(start + hop) % slugs.length], at });
    at += 55 + 260 * (hop / hops) ** 3;
  }
  return stops;
}

/** Search words too short to mean anything on their own ("a"), which the highlighter skips. */
export const highlightable = (terms: string[]) =>
  terms.filter((term) => term.length > 1);
