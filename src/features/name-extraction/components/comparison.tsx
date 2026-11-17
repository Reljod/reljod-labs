"use client";

import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";
import type { Comparison, ComparisonRow } from "../domain/contract";
import { HeatStrip, type Tick } from "./heat-strip";
import { SOFT, Ticker } from "./motion-kit";
import { DOT, NameButton, type NameEntry } from "./names-panel";
import { MARK_CLASS, PaperPage } from "./paper-page";
import { plural } from "./plain";
import { ReaderPane, useJumper } from "./reader-pane";
import { Button, cx } from "./ui";
import { type PageLoader, usePages } from "./use-pages";

const entryOf = (row: ComparisonRow): NameEntry => ({
  name: row.name,
  type: row.type,
  status: row.status,
  pages: row.pages,
  hard: row.hard,
  hardReason: row.hardReason ?? null,
  foundAs: row.foundAs,
});

/** The headline number as a ring that fills. */
export function ScoreRing({
  found,
  expected,
}: {
  found: number;
  expected: number;
}) {
  const reduce = useReducedMotion();
  const share = expected > 0 ? found / expected : 1;
  return (
    <div className="relative size-36 shrink-0 sm:size-44">
      <svg
        viewBox="0 0 120 120"
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeWidth="10"
        />
        <motion.circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={
            share === 1 ? "var(--color-ivy)" : "var(--color-federal-blue)"
          }
          strokeWidth="10"
          strokeLinecap="round"
          initial={{ pathLength: reduce ? share : 0 }}
          animate={{ pathLength: share }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-4xl leading-none font-bold tabular-nums sm:text-5xl">
          <Ticker value={found} format={(value) => String(Math.round(value))} />
        </span>
        <span className="font-mono text-xs text-ink-muted">of {expected}</span>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    { status: "found", label: "found" },
    { status: "missed", label: "missed" },
    { status: "extra", label: "extra, worth a look" },
  ] as const;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
      {items.map((item) => (
        <li key={item.status} className="flex items-center gap-1.5">
          <span
            className={cx(
              "rounded-sm px-1.5 font-mono text-[0.68rem]",
              MARK_CLASS[item.status],
            )}
          >
            Name
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function RowList({
  title,
  tone,
  rows,
  empty,
  active,
  onPick,
}: {
  title: string;
  tone: "missed" | "extra" | "found";
  rows: ComparisonRow[];
  empty: ReactNode;
  active: string | null;
  onPick: (entry: NameEntry) => void;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h4
        className={cx(
          "eyebrow flex items-center gap-2 px-2 text-[0.62rem]",
          tone === "missed"
            ? "text-seal-red"
            : tone === "extra"
              ? "text-oak"
              : "text-ivy",
        )}
      >
        <span className={cx("size-2 rounded-full", DOT[tone])} />
        {title} · {rows.length}
      </h4>
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={`${row.status}-${row.name}`}>
              <NameButton
                entry={entryOf(row)}
                active={active === row.name}
                onPick={onPick}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A demo Run against the answer key: the score, then the document twice,
 * side by side and scrolling together, "In the document" with every name the
 * key expects (green found, red missed) and "Sieve found" with what the Run
 * marked (green, amber for extras). A shared strip ticks the misses and
 * extras; the lists beside it jump to them.
 */
export function ComparisonView({
  loader,
  total,
  comparison,
  summary,
}: {
  loader: PageLoader;
  total: number;
  comparison: Comparison;
  /** The facts line under the headline: pages, cost, time. */
  summary?: ReactNode;
}) {
  const pages = usePages(loader, total);
  const jumper = useJumper();
  const [side, setSide] = useState<"key" | "run">("key");
  const { rows, score } = comparison;
  const { missed, extras, found, ticks } = useMemo(() => {
    const missed = rows.filter((row) => row.status === "missed");
    const extras = rows.filter((row) => row.status === "extra");
    const found = rows.filter((row) => row.status === "found");
    const ticks: Tick[] = [
      ...extras.flatMap((row) =>
        row.pages.map((page) => ({ page, tone: "extra" as const })),
      ),
      ...missed.flatMap((row) =>
        row.pages.map((page) => ({ page, tone: "missed" as const })),
      ),
    ];
    return { missed, extras, found, ticks };
  }, [rows]);
  const expected = score?.expected ?? found.length + missed.length;
  const hit = score?.truePositives ?? found.length;

  const density = useMemo(() => {
    const counts = new Uint16Array(total);
    for (const row of rows)
      if (row.status !== "extra")
        for (const page of row.pages)
          if (page >= 1 && page <= total) counts[page - 1]++;
    return counts;
  }, [rows, total]);

  return (
    <div className="flex flex-col gap-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SOFT}
        className="outline-box flex flex-col items-center gap-5 rounded-sm bg-paper p-5 shadow-hard-md sm:flex-row sm:gap-8 sm:p-7"
      >
        <ScoreRing found={hit} expected={expected} />
        <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          <p className="eyebrow text-[0.65rem] text-ivy">
            Checked against the answer key
          </p>
          <p className="font-mono text-2xl leading-tight font-bold uppercase sm:text-4xl">
            Found {hit} of {expected} names
          </p>
          <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm sm:justify-start">
            <span
              className={
                missed.length ? "font-semibold text-seal-red" : "text-ivy"
              }
            >
              {missed.length
                ? `${plural(missed.length, "name")} missed`
                : "Nothing missed"}
            </span>
            <span className="text-ink-muted">·</span>
            <span className={extras.length ? "text-oak" : "text-ink-muted"}>
              {extras.length
                ? `${plural(extras.length, "extra")} to review`
                : "no extras"}
            </span>
            {summary ? (
              <>
                <span className="text-ink-muted">·</span>
                <span className="text-ink-muted">{summary}</span>
              </>
            ) : null}
          </p>
          <Legend />
        </div>
      </motion.div>

      <div className="flex flex-col gap-4">
        <aside className="grid min-w-0 gap-3 md:grid-cols-3 [&>*]:max-h-56 [&>*]:overflow-y-auto [&>*]:rounded-sm [&>*]:border-2 [&>*]:border-ink [&>*]:bg-paper [&>*]:p-2">
          <RowList
            title="Missed"
            tone="missed"
            rows={missed}
            empty="None. Every name in the key was found."
            active={jumper.pulse?.name ?? null}
            onPick={jumper.pick}
          />
          <RowList
            title="Extras"
            tone="extra"
            rows={extras}
            empty="None."
            active={jumper.pulse?.name ?? null}
            onPick={jumper.pick}
          />
          <details className="group">
            <summary className="eyebrow flex cursor-pointer list-none items-center gap-2 px-2 text-[0.62rem] text-ivy">
              <span className={cx("size-2 rounded-full", DOT.found)} />
              Found · {found.length}
              <span aria-hidden="true" className="ml-auto group-open:rotate-90">
                ▸
              </span>
            </summary>
            <ul className="mt-1">
              {found.map((row) => (
                <li key={`found-${row.name}`}>
                  <NameButton
                    entry={entryOf(row)}
                    active={jumper.pulse?.name === row.name}
                    onPick={jumper.pick}
                  />
                </li>
              ))}
            </ul>
          </details>
        </aside>

        <div className="flex min-w-0 flex-col gap-2">
          <div
            className="flex items-center gap-2 lg:hidden"
            role="tablist"
            aria-label="Which side"
          >
            {(["key", "run"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={side === item}
                onClick={() => setSide(item)}
                className={cx(
                  "outline-box press h-9 flex-1 rounded-sm font-mono text-xs font-bold uppercase",
                  side === item ? "bg-ink text-paper" : "bg-paper",
                )}
              >
                {item === "key" ? "In the document" : "Sieve found"}
              </button>
            ))}
          </div>
          <div className="hidden grid-cols-2 gap-3 pr-8 lg:grid">
            <p className="eyebrow text-[0.65rem] text-ink-muted">
              In the document
            </p>
            <p className="eyebrow text-[0.65rem] text-ink-muted">Sieve found</p>
          </div>
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
              className="outline-box min-w-0 flex-1 rounded-sm bg-limestone p-2 sm:p-3"
              stamp={(page) => [
                pages.get(page),
                jumper.pulse?.page === page ? jumper.pulse.nonce : 0,
                side,
              ]}
              renderPage={(page) => {
                const item = pages.get(page);
                const pulse = jumper.pulse?.page === page ? jumper.pulse : null;
                return (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className={side === "key" ? "" : "hidden lg:block"}>
                      <PaperPage
                        number={page}
                        total={total}
                        page={item}
                        marks={item?.key ?? null}
                        pulse={pulse}
                        label="In the document"
                      />
                    </div>
                    <div className={side === "run" ? "" : "hidden lg:block"}>
                      <PaperPage
                        number={page}
                        total={total}
                        page={item}
                        marks={item?.run ?? null}
                        pulse={pulse}
                        label="Sieve found"
                      />
                    </div>
                  </div>
                );
              }}
            />
            <HeatStrip
              total={total}
              density={density}
              ticks={ticks}
              first={jumper.range.first}
              last={jumper.range.last}
              onJump={jumper.jump}
              label="Misses and extras"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
