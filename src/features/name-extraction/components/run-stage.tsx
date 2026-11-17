"use client";

import {
  AnimatePresence,
  type MotionValue,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ExtractedName } from "../domain/contract";
import { clockText } from "./format";
import { Clock, SOFT, SPRING, Ticker } from "./motion-kit";
import { PageTiles, readerColor } from "./page-map";
import {
  type Activity,
  type ActivityKind,
  activityOf,
  firstPage,
  namesPerPage,
  pageMap,
  plural,
  revealable,
} from "./plain";
import { isOver, type RunView } from "./run-view";
import { cx } from "./ui";
import { useReveal } from "./use-reveal";

const keyOf = (name: ExtractedName) => name.canonical.trim().toLowerCase();

type Spark = {
  id: string;
  label: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
};

/**
 * Pages that just gave up a name flash, and the name flies from its page to
 * the list. Positions are measured against the stage, so the flight works at
 * any width.
 */
function useDiscoveries(
  names: ExtractedName[],
  stage: RefObject<HTMLDivElement | null>,
  map: RefObject<HTMLDivElement | null>,
  list: RefObject<HTMLDivElement | null>,
) {
  const reduce = useReducedMotion();
  const seen = useRef<Set<string> | null>(null);
  const [hot, setHot] = useState<ReadonlySet<number>>(new Set());
  const [sparks, setSparks] = useState<Spark[]>([]);

  useEffect(() => {
    const keys = new Set(names.map(keyOf));
    const before = seen.current;
    seen.current = keys;
    // The first batch (a reload, a finished Run) arrives without fanfare.
    if (!before || names.length - before.size > 40) return;
    const fresh = names.filter((name) => !before.has(keyOf(name)));
    if (fresh.length === 0) return;
    const pages = new Set(fresh.map(firstPage));
    setHot(pages);
    const clear = setTimeout(() => setHot(new Set()), 950);
    if (reduce || !stage.current || !map.current || !list.current)
      return () => clearTimeout(clear);
    const origin = stage.current.getBoundingClientRect();
    const target = list.current.getBoundingClientRect();
    const made: Spark[] = fresh.slice(0, 10).flatMap((name, index) => {
      const tile = map.current?.querySelector(
        `[data-page="${firstPage(name)}"]`,
      );
      if (!tile) return [];
      const box = tile.getBoundingClientRect();
      const x = box.left + box.width / 2 - origin.left;
      const y = box.top + box.height / 2 - origin.top;
      return [
        {
          id: `${keyOf(name)}-${Date.now()}`,
          label: name.canonical,
          x,
          y,
          dx: target.left + 24 - origin.left - x,
          dy: target.top + 20 - origin.top - y,
          delay: index * 0.09,
        },
      ];
    });
    setSparks((current) => [...current, ...made].slice(-16));
    return () => clearTimeout(clear);
  }, [names, reduce, stage, map, list]);

  const done = (id: string) =>
    setSparks((current) => current.filter((spark) => spark.id !== id));
  return { hot, sparks, done };
}

const KIND_GLYPH: Record<ActivityKind, string> = {
  map: "▦",
  read: "▤",
  readers: "⇉",
  search: "⌕",
  code: "{}",
  playbook: "❏",
  names: "+",
  check: "✓",
  note: "!",
};

function Counter({
  label,
  children,
  sub,
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="eyebrow text-[0.62rem] text-paper/55">{label}</span>
      <span className="font-mono text-[1.6rem] leading-none font-bold tabular-nums sm:text-[2.1rem]">
        {children}
      </span>
      {sub ? (
        <span className="truncate font-mono text-[0.68rem] text-paper/50">
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function NamesFeed({
  names,
  listRef,
}: {
  names: ExtractedName[];
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const latest = useMemo(() => names.slice(-30).reverse(), [names]);
  const people = names.filter((name) => name.type === "person").length;
  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-sm border-2 border-paper/25 bg-paper/[0.04]">
      <div
        ref={listRef}
        className="flex items-baseline justify-between gap-2 border-paper/10 border-b px-3 py-2"
      >
        <span className="eyebrow text-[0.62rem] text-paper/60">
          Names found
        </span>
        <span className="font-mono text-[0.68rem] text-paper/50">
          {people} people · {names.length - people} orgs
        </span>
      </div>
      <ul
        aria-live="off"
        className="sv-scroll-dark flex max-h-56 flex-col gap-1 overflow-y-auto p-2 lg:max-h-none lg:flex-1"
      >
        {names.length === 0 ? (
          <li className="px-1 py-2 text-sm text-paper/45">
            Names appear here as they are found.
          </li>
        ) : null}
        <AnimatePresence initial={false}>
          {latest.map((name) => (
            <motion.li
              key={keyOf(name)}
              layout="position"
              initial={{ opacity: 0, x: -14, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={SPRING}
              className="flex items-center gap-2 rounded-sm bg-paper/[0.05] px-2 py-1"
            >
              <span
                aria-hidden="true"
                className={cx(
                  "size-2 shrink-0",
                  name.type === "person"
                    ? "rounded-full bg-clear-sky"
                    : "rounded-[1px] bg-brass",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[0.82rem]">
                {name.canonical}
              </span>
              <span className="shrink-0 font-mono text-[0.62rem] text-paper/45">
                p.{firstPage(name)}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function ActivityFeed({ items }: { items: Activity[] }) {
  const shown = items.slice(-4).reverse();
  return (
    <ol aria-label="What Sieve is doing" className="flex flex-col gap-1">
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((item, index) => (
          <motion.li
            key={item.key}
            layout="position"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: index === 0 ? 1 : 0.62 - index * 0.12, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SOFT}
            className="flex min-w-0 items-center gap-2 text-sm"
          >
            <span
              aria-hidden="true"
              className={cx(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-sm font-mono text-[0.62rem] font-bold",
                item.failed
                  ? "bg-seal-red/80 text-paper"
                  : item.kind === "check"
                    ? "bg-ivy text-paper"
                    : "bg-paper/10 text-paper/80",
              )}
            >
              {KIND_GLYPH[item.kind]}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.text}</span>
            {item.live ? (
              <span className="size-1.5 shrink-0 rounded-full bg-clear-sky motion-safe:animate-pulse" />
            ) : null}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/**
 * The run, shown: counters that tick up, the page map lighting as readers
 * sweep their ranges, names flying into the list, and what it is doing in
 * plain words. The hero's replay and a live Run draw the same stage.
 */
export function RunStage({
  view,
  total,
  clock,
  top,
  overlay,
  footer,
  pool,
}: {
  view: RunView;
  /** Every name the Run will end with (a recorded Run), revealed as pages are read. */
  pool?: ExtractedName[];
  total: number;
  /** Elapsed milliseconds, real for a live Run, sped up for a replay. */
  clock: MotionValue<number>;
  top?: ReactNode;
  overlay?: ReactNode;
  footer?: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const map = useMemo(() => pageMap(view, total), [view, total]);
  const over = isOver(view.status);
  const source = pool ?? view.names;
  const candidates = useMemo(
    () => revealable(source, map.state, over),
    [source, map.state, over],
  );
  const names = useReveal(
    candidates,
    `${view.document?.id ?? ""}:${view.startedAt ?? ""}`,
  );
  const density = useMemo(() => namesPerPage(names, total), [names, total]);
  const activity = useMemo(() => activityOf(view), [view]);
  const { hot, sparks, done } = useDiscoveries(names, stage, mapBox, list);
  const reading = view.readers.filter((reader) => reader.state === "start");

  return (
    <div
      ref={stage}
      className="sv-stage outline-box relative isolate overflow-hidden rounded-sm bg-ink text-paper shadow-hard-lg"
    >
      {top}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-paper/10 border-b px-4 py-4 sm:grid-cols-4 sm:px-6">
        <Counter label="Pages read" sub={`of ${total.toLocaleString("en-US")}`}>
          <Ticker
            value={map.read}
            format={(value) => Math.round(value).toLocaleString("en-US")}
          />
        </Counter>
        <Counter
          label="Names found"
          sub={
            reading.length > 0
              ? `${plural(reading.length, "reader")} at work`
              : "people and organizations"
          }
        >
          <Ticker
            value={names.length}
            format={(value) => String(Math.round(value))}
          />
        </Counter>
        <Counter label="Cost" sub="model spend, USD">
          <Ticker
            value={view.cost.total.costUsd}
            format={(value) => `$${value.toFixed(2)}`}
          />
        </Counter>
        <Counter label="Time" sub="wall clock">
          <Clock value={clock} format={clockText} />
        </Counter>
      </div>
      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div ref={mapBox} className="contents">
            <PageTiles map={map} density={density} hot={hot} total={total} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.65rem] text-paper/55">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-paper/[0.07] ring-1 ring-paper/20" />
              not read yet
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[2px]"
                style={{ background: readerColor(0) }}
              />
              a reader agent at work
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-paper/90" />
              read
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-2.5 bg-brass" />
              names on the page
            </span>
          </div>
        </div>
        <NamesFeed names={names} listRef={list} />
      </div>
      <div className="border-paper/10 border-t px-4 py-3 sm:px-6">
        <ActivityFeed items={activity} />
      </div>
      {footer}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {sparks.map((spark) => (
          <motion.span
            key={spark.id}
            className="absolute top-0 left-0 max-w-[11rem] truncate rounded-sm border-2 border-ink bg-brass px-1.5 py-0.5 font-mono text-[0.62rem] font-bold whitespace-nowrap text-ink shadow-[2px_2px_0_var(--color-paper)]"
            initial={{ x: spark.x, y: spark.y, scale: 0.3, opacity: 0 }}
            animate={{
              x: [spark.x, spark.x + spark.dx * 0.35, spark.x + spark.dx],
              y: [spark.y, spark.y + spark.dy * 0.35 - 40, spark.y + spark.dy],
              scale: [0.3, 1.05, 0.7],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: 0.95,
              delay: spark.delay,
              ease: [0.22, 1, 0.36, 1],
            }}
            onAnimationComplete={() => done(spark.id)}
          >
            {spark.label}
          </motion.span>
        ))}
      </div>
      {overlay}
    </div>
  );
}
