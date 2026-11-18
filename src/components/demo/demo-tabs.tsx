"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  type DemoBarRowFrom,
  demoTabClass,
  demoTabsClass,
} from "./demo-bar-styles";

export type DemoViewTab = {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
  testId?: string;
  onSelect: () => void;
  /**
   * The tab is about to be opened: a pointer rested on it, or it took focus.
   * For loading what the tab shows ahead of the click.
   */
  onIntent?: () => void;
};

/** How long a pointer rests on a tab before it counts as intent. */
export const INTENT_REST_MS = 120;

/**
 * Views a demo swaps itself, as a tablist: arrow keys, Home and End move
 * between them, and only the open one sits in the tab order. With `panelsId`
 * each tab names its panel as `<panelsId>-panel-<id>` and is named
 * `<panelsId>-tab-<id>`, for a panel to point back at.
 */
export function DemoTabs({
  tabs,
  current,
  panelsId,
  rowFrom = "lg",
}: {
  tabs: DemoViewTab[];
  current?: string;
  panelsId?: string;
  rowFrom?: DemoBarRowFrom;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rest = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useCallback(() => {
    if (rest.current) clearTimeout(rest.current);
    rest.current = null;
  }, []);
  useEffect(() => settle, [settle]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === current);
    const last = tabs.length - 1;
    const to =
      event.key === "ArrowRight"
        ? index < 0 || index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index <= 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    const next = tabs[to];
    next.onSelect();
    refs.current[next.id]?.focus();
  };

  // With nothing open, the first tab takes the tab stop.
  const stop = tabs.some((tab) => tab.id === current) ? current : tabs[0]?.id;

  return (
    <div
      role="tablist"
      aria-label="Sections"
      onKeyDown={onKeyDown}
      className={demoTabsClass(rowFrom)}
    >
      {tabs.map((tab) => {
        const active = tab.id === current;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[tab.id] = element;
            }}
            id={panelsId ? `${panelsId}-tab-${tab.id}` : undefined}
            type="button"
            role="tab"
            data-testid={tab.testId}
            aria-selected={active}
            aria-controls={
              panelsId && active ? `${panelsId}-panel-${tab.id}` : undefined
            }
            tabIndex={tab.id === stop ? 0 : -1}
            onClick={tab.onSelect}
            onPointerEnter={
              tab.onIntent
                ? () => {
                    settle();
                    rest.current = setTimeout(
                      () => tab.onIntent?.(),
                      INTENT_REST_MS,
                    );
                  }
                : undefined
            }
            onPointerLeave={tab.onIntent ? settle : undefined}
            onFocus={tab.onIntent}
            className={demoTabClass(active)}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge !== null ? (
              <span
                className={`rounded-sm px-1.5 py-px text-[10px] ${active ? "bg-paper/20" : "bg-limestone"}`}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
