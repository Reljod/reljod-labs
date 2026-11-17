import Link from "next/link";
import type { ReactNode } from "react";
import { ProjectMarks } from "@/components/ui/project-marks";
import { liveDemos } from "@/content/projects";
import {
  type DemoBarRowFrom,
  demoBarControlClass,
  demoBarNameClass,
  demoBarRowClass,
  demoTabClass,
  demoTabsClass,
} from "./demo-bar-styles";
import { DemoTabs, type DemoViewTab } from "./demo-tabs";

export { demoBarControlClass };

/** Where every demo's back button goes: the top of the landing page. */
export const ALL_DEMOS_HREF = "/";

type DemoSlug =
  | "document-compliance-checks"
  | "ledger"
  | "casework-desk"
  | "client-manager"
  | "process-transfer"
  | "bank-harness"
  | "name-extraction";

/** A place inside a demo: a page (`href`) or a view the demo swaps itself (`onSelect`). */
export type DemoTab =
  | DemoViewTab
  | { id: string; label: ReactNode; testId?: string; href: string };

/**
 * The bar across the top of every demo: the same back button to the live
 * demos, the demo's number and name (back to its first page) with its
 * New / Beta marks, its places, and room on the right for the demo's own controls.
 */
export function DemoBar({
  slug,
  name,
  tabs = [],
  current,
  panelsId,
  titleAs: Title = "span",
  badge,
  rowFrom = "lg",
  children,
}: {
  slug: DemoSlug;
  /** The short name shown in the bar. */
  name: string;
  tabs?: DemoTab[];
  /** The id of the tab that is open, if any. */
  current?: string;
  /** For view tabs: ties each tab to its panel (see `DemoTabs`). */
  panelsId?: string;
  /** "h1" when the bar carries the page's only title. */
  titleAs?: "h1" | "span";
  /** A small mark beside the name, such as "Synthetic data". */
  badge?: ReactNode;
  /** From which width the bar is one row ("lg" by default; "xl" for a demo with many places). */
  rowFrom?: DemoBarRowFrom;
  children?: ReactNode;
}) {
  const index = liveDemos.findIndex((demo) => demo.slug === slug);
  const demo = liveDemos[index];
  const home = demo?.href ?? ALL_DEMOS_HREF;
  const buttons = tabs.some((tab) => "onSelect" in tab);

  return (
    <header className="sticky top-0 z-30 shrink-0 border-ink border-b-2 bg-marble text-ink">
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4 ${demoBarRowClass[rowFrom]}`}
      >
        <Link
          href={ALL_DEMOS_HREF}
          data-testid="demo-back"
          className="outline-box press eyebrow flex h-9 shrink-0 items-center gap-2 rounded-sm bg-paper px-2.5 font-bold"
        >
          <span aria-hidden="true">←</span>
          <span className="sr-only sm:not-sr-only">All demos</span>
        </Link>

        {/* Grows from nothing, so on phones the controls keep to the first row. */}
        <div
          className={`flex min-w-0 flex-1 basis-0 items-center gap-3 ${demoBarNameClass[rowFrom]}`}
        >
          <Link
            href={home}
            className="flex min-w-0 items-center gap-2 font-mono font-bold uppercase hover:text-federal-blue"
          >
            {index >= 0 ? (
              <span
                aria-hidden="true"
                className="rounded-sm bg-ink px-1.5 py-0.5 text-[11px] tracking-[0.08em] text-paper"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
            ) : null}
            <Title className="truncate text-sm tracking-[0.1em]">{name}</Title>
          </Link>
          {demo?.marks?.length ? (
            <span
              data-testid="demo-marks"
              className="-ml-1 hidden shrink-0 items-center gap-1 sm:flex"
            >
              <ProjectMarks marks={demo.marks} size="sm" />
            </span>
          ) : null}
          {badge ? (
            <span className="hidden shrink-0 md:inline">{badge}</span>
          ) : null}
        </div>

        {tabs.length === 0 ? null : buttons ? (
          <DemoTabs
            tabs={tabs.filter((tab): tab is DemoViewTab => "onSelect" in tab)}
            current={current}
            panelsId={panelsId}
            rowFrom={rowFrom}
          />
        ) : (
          <nav aria-label={name} className={demoTabsClass(rowFrom)}>
            {tabs.map((tab) =>
              "href" in tab ? (
                <Link
                  key={tab.id}
                  href={tab.href}
                  data-testid={tab.testId}
                  aria-current={tab.id === current ? "page" : undefined}
                  className={demoTabClass(tab.id === current)}
                >
                  {tab.label}
                </Link>
              ) : null,
            )}
          </nav>
        )}

        {children ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {children}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** A small stamped label for the bar, in the demo's own voice. */
export function DemoBarBadge({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow rounded-sm border border-ink bg-paper px-1.5 py-0.5 text-[10px] font-bold">
      {children}
    </span>
  );
}
