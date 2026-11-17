import { type Heading, headingsOf, parseMarkdown } from "../domain/markdown";
import {
  isTabId,
  LINK_PARAMS,
  type LinkParams,
  type TabId,
} from "../domain/place";
import { liveMarkdown } from "./live";
import type { DocBlock, DocPage, DocSection } from "./types";

/** The Markdown a block holds, or null for a diagram. */
export function blockMarkdown(block: DocBlock): string | null {
  if (typeof block === "string") return block;
  if ("live" in block) return liveMarkdown(block.live, block.arg);
  return null;
}

/** Every Markdown block of a page, live tables built, diagrams left out. */
export function pageBlocks(page: DocPage): string[] {
  return page.body.flatMap((block) => {
    const text = blockMarkdown(block);
    return text === null ? [] : [text];
  });
}

/** The page's whole text, for search. */
export function pageText(page: DocPage): string {
  return pageBlocks(page).join("\n\n");
}

/** The h2 and h3 headings of a page in order, with the anchors the page's headings get. */
export function outlineOf(page: DocPage): Heading[] {
  return pageBlocks(page)
    .flatMap((text) => headingsOf(parseMarkdown(text)))
    .filter((heading) => heading.level === 2 || heading.level === 3);
}

/** All headings of a page, whatever the level, for integrity checks. */
export function allHeadings(page: DocPage): Heading[] {
  return pageBlocks(page).flatMap((text) => headingsOf(parseMarkdown(text)));
}

const normal = (text: string) => text.toLowerCase();

/**
 * Pages that hold every word of the query in their title, summary or text,
 * best first: a word in the title counts most, then the summary, then the
 * text. An empty query returns every page in its own order.
 */
export function searchPages(pages: DocPage[], query: string): DocPage[] {
  const terms = normal(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return pages;
  const scored: { page: DocPage; score: number; order: number }[] = [];
  pages.forEach((page, order) => {
    const title = normal(page.title);
    const summary = normal(page.summary);
    const text = normal(pageText(page));
    let score = 0;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inSummary = summary.includes(term);
      const inText = text.includes(term);
      if (!inTitle && !inSummary && !inText) return;
      score += (inTitle ? 10 : 0) + (inSummary ? 3 : 0) + (inText ? 1 : 0);
    }
    if (title === normal(query).trim()) score += 20;
    scored.push({ page, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((item) => item.page);
}

/** The `doc` link parameter: `<page id>` or `<page id>#<heading>`. */
export function parseDocParam(value: string | null | undefined): {
  id: string;
  anchor: string | null;
} {
  const text = value ?? "";
  const at = text.indexOf("#");
  return at === -1
    ? { id: text, anchor: null }
    : { id: text.slice(0, at), anchor: text.slice(at + 1) || null };
}

export function docParamOf(id: string, anchor?: string | null): string {
  return anchor ? `${id}#${anchor}` : id;
}

export type DocLink =
  | { kind: "doc"; id: string; anchor: string | null }
  | { kind: "tab"; tab: TabId; params: LinkParams }
  | { kind: "anchor"; slug: string };

/**
 * What an in-doc link address means. `#doc:<id>` and `#doc:<id>#<heading>`
 * open a page; `#tab:<tab>` and `#tab:<tab>?skill=<id>` open a tab of the app;
 * any other `#<heading>` is a heading on the same page. Anything else is an
 * ordinary link and returns null.
 */
export function parseDocLink(href: string): DocLink | null {
  if (!href.startsWith("#")) return null;
  const rest = href.slice(1);
  if (rest.startsWith("doc:")) {
    const { id, anchor } = parseDocParam(rest.slice(4));
    return id ? { kind: "doc", id, anchor } : null;
  }
  if (rest.startsWith("tab:")) {
    const [name = "", search = ""] = rest.slice(4).split("?");
    if (!isTabId(name)) return null;
    const params: LinkParams = {};
    const query = new URLSearchParams(search);
    for (const key of LINK_PARAMS) {
      const value = query.get(key);
      if (value) params[key] = value;
    }
    return { kind: "tab", tab: name, params };
  }
  return rest ? { kind: "anchor", slug: rest } : null;
}

/** Every link address in some Markdown, for integrity checks. */
export function linkAddresses(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

/** The previous and next page in reading order. */
export function neighbours(
  sections: DocSection[],
  pages: DocPage[],
  id: string,
): { previous: DocPage | null; next: DocPage | null } {
  const order = sections.flatMap((section) => section.pages);
  const index = order.indexOf(id);
  const pick = (at: number) => {
    const pageId = order[at];
    return pages.find((page) => page.id === pageId) ?? null;
  };
  return {
    previous: index > 0 ? pick(index - 1) : null,
    next: index >= 0 && index < order.length - 1 ? pick(index + 1) : null,
  };
}
