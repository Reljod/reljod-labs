"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  docParamOf,
  neighbours,
  outlineOf,
  parseDocLink,
  parseDocParam,
  searchPages,
} from "../../docs/lib";
import { liveMarkdown } from "../../docs/live";
import { FIRST_PAGE_ID, PAGES, pageById, SECTIONS } from "../../docs/registry";
import type { DocBlock, DocPage } from "../../docs/types";
import { useHarness } from "../harness-context";
import { scrollWithin } from "../scroll";
import { cx, inputClass, Markdown } from "../ui";
import { Diagram } from "./diagrams";

function sectionTitle(page: DocPage): string {
  return SECTIONS.find((section) => section.id === page.section)?.title ?? "";
}

/** The Docs' whole interface: navigation, search, a page, its outline and previous/next links. */
export default function DocsViewer() {
  const { place, openTab, hrefFor } = useHarness();
  const { id: wantedId, anchor } = parseDocParam(place.params.doc);
  const page = pageById(wantedId) ?? (pageById(FIRST_PAGE_ID) as DocPage);

  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const searchId = useId();

  const results = useMemo(() => searchPages(PAGES, query), [query]);
  const searching = query.trim() !== "";
  const outline = useMemo(() => outlineOf(page), [page]);
  const { previous, next } = useMemo(
    () => neighbours(SECTIONS, PAGES, page.id),
    [page.id],
  );

  const scrollToHeading = (slug: string) => {
    const root = articleRef.current;
    if (!root) return;
    const target = Array.from(root.querySelectorAll<HTMLElement>("[id]")).find(
      (element) => element.id === slug,
    );
    scrollWithin(target, "start", "auto");
  };

  // A new page starts at the top, or at the heading the link named.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of page or anchor moves the scroll
  useEffect(() => {
    if (anchor) scrollToHeading(anchor);
    else articleRef.current?.scrollTo({ top: 0 });
  }, [page.id, anchor]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const go = (id: string, to?: string | null) => {
    setDrawer(false);
    openTab("docs", { doc: docParamOf(id, to) });
  };

  const onLink = (href: string): boolean => {
    const link = parseDocLink(href);
    if (!link) return false;
    if (link.kind === "doc") {
      if (link.id === page.id && link.anchor) scrollToHeading(link.anchor);
      else go(link.id, link.anchor);
    } else if (link.kind === "tab") {
      openTab(link.tab, link.params);
    } else {
      scrollToHeading(link.slug);
    }
    return true;
  };

  const pageLink = (
    target: DocPage,
    children: ReactNode,
    className: string,
  ) => (
    <a
      href={hrefFor("docs", { doc: target.id })}
      aria-current={target.id === page.id ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        go(target.id);
      }}
      className={className}
    >
      {children}
    </a>
  );

  const navigation = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-ink border-b-2 p-3">
        <label htmlFor={searchId} className="sr-only">
          Search the documentation
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the docs"
          autoComplete="off"
          className={inputClass}
        />
      </div>
      <nav
        aria-label="Documentation"
        className="hx-scroll min-h-0 flex-1 px-2 py-3"
      >
        {searching ? (
          results.length === 0 ? (
            <output className="block px-2 text-sm text-ink-muted">
              No page matches “{query.trim()}”.
            </output>
          ) : (
            <ul className="flex flex-col gap-0.5" aria-label="Search results">
              {results.map((result) => (
                <li key={result.id}>
                  {pageLink(
                    result,
                    <>
                      <span className="block text-sm font-medium">
                        {result.title}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {sectionTitle(result)}
                      </span>
                    </>,
                    cx(
                      "block rounded-sm px-2 py-1.5 hover:bg-marble focus-visible:outline-2 focus-visible:outline-federal-blue",
                      result.id === page.id && "bg-morning-haze/60",
                    ),
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          SECTIONS.map((section) => (
            <div key={section.id} className="mb-4">
              <h2 className="eyebrow px-2 pb-1 text-[0.65rem] text-ink-muted">
                {section.title}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {section.pages.map((pageId) => {
                  const entry = pageById(pageId);
                  if (!entry) return null;
                  const current = entry.id === page.id;
                  return (
                    <li key={entry.id}>
                      {pageLink(
                        entry,
                        entry.title,
                        cx(
                          "block rounded-sm px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-federal-blue",
                          current
                            ? "bg-morning-haze/60 font-semibold text-ink"
                            : "text-ink-muted hover:bg-marble hover:text-ink",
                        ),
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );

  return (
    <div className="hx-docs flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col border-ink border-r-2 bg-paper md:flex">
        {navigation}
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close the page list"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setDrawer(false)}
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-paper shadow-xl"
            aria-label="Pages"
          >
            <div className="flex items-center justify-between border-ink border-b-2 px-3 py-2">
              <span className="text-sm font-semibold">Pages</span>
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="rounded-sm px-2 py-1 text-sm text-ink-muted hover:bg-marble hover:text-ink"
              >
                Close
              </button>
            </div>
            {navigation}
          </aside>
        </div>
      ) : null}

      <article
        ref={articleRef}
        aria-label={page.title}
        className="hx-scroll min-w-0 flex-1 bg-paper"
      >
        <div className="mx-auto flex max-w-6xl gap-8 px-4 py-5 sm:px-8">
          <div className="min-w-0 max-w-3xl flex-1">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="mb-4 inline-flex h-8 items-center gap-2 rounded-sm outline-box px-3 text-sm md:hidden"
            >
              <span aria-hidden="true">☰</span> Pages
            </button>

            <p className="eyebrow text-[0.65rem] text-ink-muted">
              {sectionTitle(page)}
            </p>
            <h1 className="mt-1 font-mono text-2xl leading-tight font-bold uppercase">
              {page.title}
            </h1>
            <p className="mt-2 text-base text-ink-muted">{page.summary}</p>

            {outline.length > 0 ? (
              <details className="mt-4 rounded-sm outline-box xl:hidden">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                  On this page
                </summary>
                <OutlineList
                  outline={outline}
                  onPick={(slug) => scrollToHeading(slug)}
                />
              </details>
            ) : null}

            <div className="hx-doc-body mt-6">
              <PageBody page={page} onLink={onLink} />
            </div>

            <footer className="mt-10 grid gap-3 border-ink border-t-2 pt-4 sm:grid-cols-2">
              {previous ? (
                pageLink(
                  previous,
                  <>
                    <span className="block text-xs text-ink-muted">
                      Previous
                    </span>
                    <span className="block font-medium">{previous.title}</span>
                  </>,
                  "block rounded-sm outline-box px-3 py-2 hover:bg-marble focus-visible:outline-2 focus-visible:outline-federal-blue",
                )
              ) : (
                <span />
              )}
              {next
                ? pageLink(
                    next,
                    <>
                      <span className="block text-xs text-ink-muted">Next</span>
                      <span className="block font-medium">{next.title}</span>
                    </>,
                    "block rounded-sm outline-box px-3 py-2 text-right hover:bg-marble focus-visible:outline-2 focus-visible:outline-federal-blue sm:col-start-2",
                  )
                : null}
            </footer>
          </div>

          {outline.length > 0 ? (
            <aside
              aria-label="On this page"
              className="hidden w-52 shrink-0 xl:block"
            >
              <div className="sticky top-4">
                <p className="eyebrow pb-1 text-[0.65rem] text-ink-muted">
                  On this page
                </p>
                <OutlineList
                  outline={outline}
                  onPick={(slug) => scrollToHeading(slug)}
                />
              </div>
            </aside>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function OutlineList({
  outline,
  onPick,
}: {
  outline: { level: number; text: string; slug: string }[];
  onPick: (slug: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5 px-2 py-1 text-sm">
      {outline.map((heading) => (
        <li key={heading.slug} className={heading.level === 3 ? "pl-3" : ""}>
          <a
            href={`#${heading.slug}`}
            onClick={(event) => {
              event.preventDefault();
              onPick(heading.slug);
            }}
            className="block rounded-sm px-1.5 py-0.5 text-ink-muted hover:bg-marble hover:text-ink focus-visible:outline-2 focus-visible:outline-federal-blue"
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A page's blocks in order: Markdown, diagrams and live tables. */
function PageBody({
  page,
  onLink,
}: {
  page: DocPage;
  onLink: (href: string) => boolean;
}) {
  const drawn = useMemo(
    () =>
      page.body.map((block: DocBlock) =>
        typeof block === "string"
          ? block
          : "live" in block
            ? liveMarkdown(block.live, block.arg)
            : block,
      ),
    [page],
  );
  return (
    <>
      {drawn.map((block, index) =>
        typeof block === "string" ? (
          <Markdown
            // The page's blocks never reorder, so a place is identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            text={block}
            anchors
            onLink={onLink}
          />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <Diagram key={index} id={block.diagram} />
        ),
      )}
    </>
  );
}
