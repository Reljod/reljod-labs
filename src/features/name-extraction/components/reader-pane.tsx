"use client";

import { useReducedMotion } from "motion/react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type PaneHandle = {
  jump: (page: number) => void;
  /** Jumps to a page, then centres the first mark of `name` on it once it has loaded. */
  reveal: (page: number, name: string) => void;
};

/**
 * A scrolling column of every page of a Document. Only pages near the screen
 * ask for their text (`onNear`); the rest are placeholders the browser skips
 * rendering. Reports which pages are on screen, and jumps to a page.
 */
export function ReaderPane({
  total,
  renderPage,
  onNear,
  onRange,
  handle,
  className = "",
}: {
  total: number;
  renderPage: (page: number) => ReactNode;
  onNear: (page: number) => void;
  onRange: (first: number, last: number) => void;
  handle: RefObject<PaneHandle | null>;
  className?: string;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const near = useRef(onNear);
  near.current = onNear;
  const range = useRef(onRange);
  range.current = onRange;

  useImperativeHandle(
    handle,
    () => ({
      jump: (page: number) => {
        const element = pane.current?.querySelector<HTMLElement>(
          `[data-shell="${page}"]`,
        );
        if (!element || !pane.current) return;
        near.current(page);
        pane.current.scrollTo({
          top: element.offsetTop - 12,
          behavior: reduce ? "auto" : "smooth",
        });
      },
      reveal: (page: number, name: string) => {
        const root = pane.current;
        const shell = root?.querySelector<HTMLElement>(
          `[data-shell="${page}"]`,
        );
        if (!root || !shell) return;
        near.current(page);
        // The lists sit above the pane: bring the pane itself on screen too.
        const box = root.getBoundingClientRect();
        if (box.top < 0 || box.bottom > window.innerHeight)
          root.scrollIntoView({ block: "start", behavior: "instant" });
        root.scrollTo({ top: shell.offsetTop - 12, behavior: "instant" });
        // Pages above load while we wait and change height, so keep the mark
        // centred for a moment, unless the visitor starts scrolling.
        let tries = 0;
        let held = 0;
        let touched = false;
        const stop = () => {
          touched = true;
        };
        root.addEventListener("wheel", stop, { once: true, passive: true });
        root.addEventListener("touchstart", stop, {
          once: true,
          passive: true,
        });
        const find = () => {
          if (touched) return;
          const mark = shell.querySelector<HTMLElement>(
            `mark[data-name="${CSS.escape(name)}"]`,
          );
          if (mark) {
            const offset =
              mark.getBoundingClientRect().top -
              root.getBoundingClientRect().top;
            const target = root.scrollTop + offset - root.clientHeight / 3;
            if (Math.abs(target - root.scrollTop) > 2)
              root.scrollTo({ top: target, behavior: "instant" });
            if (held++ < 8) setTimeout(find, 200);
          } else if (tries++ < 20) {
            root.scrollTo({ top: shell.offsetTop - 12, behavior: "instant" });
            setTimeout(find, 100);
          }
        };
        find();
      },
    }),
    [reduce],
  );

  useEffect(() => {
    const root = pane.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            near.current(Number((entry.target as HTMLElement).dataset.shell));
      },
      { root, rootMargin: "1600px 0px" },
    );
    for (const shell of root.querySelectorAll("[data-shell]"))
      observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  // Which pages are on screen: a binary search over the shells' offsets.
  const report = useCallback(() => {
    const root = pane.current;
    if (!root) return;
    const shells = root.children;
    const find = (y: number) => {
      let low = 0;
      let high = shells.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if ((shells[middle] as HTMLElement).offsetTop <= y) low = middle;
        else high = middle - 1;
      }
      return low + 1;
    };
    range.current(
      find(root.scrollTop + 12),
      find(root.scrollTop + root.clientHeight - 12),
    );
  }, []);

  const frame = useRef(0);
  useEffect(() => {
    report();
  }, [report]);

  return (
    <div
      ref={pane}
      onScroll={() => {
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          report();
        });
      }}
      className={`sv-scroll relative flex flex-col gap-4 overflow-y-auto overscroll-contain ${className}`}
    >
      {Array.from({ length: total }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: one shell per page number, never reordered
          key={index}
          data-shell={index + 1}
          className="[overflow-anchor:auto]"
        >
          {renderPage(index + 1)}
        </div>
      ))}
    </div>
  );
}

/** What jumping around a Document needs: the pane, what is on screen, the pulse. */
export function useJumper() {
  const pane = useRef<PaneHandle>(null);
  const [range, setRange] = useState({ first: 1, last: 1 });
  const [pulse, setPulse] = useState<{
    name: string;
    page: number;
    nonce: number;
  } | null>(null);
  const onRange = useCallback(
    (first: number, last: number) =>
      setRange((current) =>
        current.first === first && current.last === last
          ? current
          : { first, last },
      ),
    [],
  );
  /** Jumps to the next page with this name after the one on screen, wrapping. */
  const pick = (entry: { name: string; pages: number[] }) => {
    const again = pulse?.name === entry.name;
    const next =
      entry.pages.find((page) =>
        again ? page > range.first : page >= range.first,
      ) ?? entry.pages[0];
    if (!next) return;
    pane.current?.reveal(next, entry.name);
    setPulse({ name: entry.name, page: next, nonce: Date.now() });
  };
  const jump = (page: number) => pane.current?.jump(page);
  return { pane, range, onRange, pulse, pick, jump };
}
