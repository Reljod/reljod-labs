"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { addDays, formatDate } from "../../domain/dates";
import { LIMITS } from "../../domain/limits";
import type { OverviewView } from "../../domain/views";
import { cx, ErrorNote, Spinner } from "../ui";
import { useCommand } from "../use-bank";
import { Notice } from "./command-dialog";
import { useDismiss } from "./use-dismiss";

const JUMPS = [
  { days: 1, label: "+1 day" },
  { days: 7, label: "+7 days" },
  { days: 31, label: "+1 month", hint: "31 days" },
] as const;

/** How long the outcome stays beside the clock. */
const OUTCOME_MS = 7_000;

/**
 * The bank's clock and its Fast-forward: the demo's signature control. The
 * bank date ticks over in place; the menu moves it by whole days, and each
 * day crossed runs end-of-day (watch it in Operations).
 */
export function BankClock({
  overview,
}: {
  overview: OverviewView | undefined;
}) {
  const advance = useCommand<{ from: string; to: string; days: number }>();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reduce = useReducedMotion();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close, advance.pending);

  // The outcome shows for a while, then gets out of the way.
  useEffect(() => {
    if (!advance.outcome) return;
    setShown(true);
    const timer = setTimeout(() => setShown(false), OUTCOME_MS);
    return () => clearTimeout(timer);
  }, [advance.outcome]);

  const daysAhead = overview?.daysAhead ?? 0;
  const room = LIMITS.clockDaysAhead - daysAhead;
  const date = overview?.bankDate;

  const jump = async (days: number) => {
    setOpen(false);
    setShown(false);
    await advance.run("advance_clock", { days });
  };

  return (
    <div ref={root} className="relative flex items-center gap-1.5">
      <div
        className="outline-box flex h-9 items-center gap-2 rounded-sm bg-paper px-2.5"
        data-testid="bank-clock"
        title={
          overview?.eodThrough
            ? `End-of-day has run through ${formatDate(overview.eodThrough)}`
            : undefined
        }
      >
        <span className="eyebrow hidden text-[0.6rem] font-bold text-ink-muted 2xl:inline">
          Bank date
        </span>
        <span
          className="relative block h-5 min-w-[5.5rem] overflow-hidden font-mono text-xs font-bold tabular-nums sm:min-w-[6.5rem] sm:text-sm"
          aria-live="polite"
          data-testid="bank-clock-date"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={date ?? "none"}
              className="absolute inset-0 flex items-center whitespace-nowrap"
              initial={reduce ? { opacity: 0 } : { y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              {date ? formatDate(date) : "…"}
            </motion.span>
          </AnimatePresence>
        </span>
        {daysAhead > 0 ? (
          <span
            className="rounded-sm border border-ink bg-brass/35 px-1 font-mono text-[0.6rem] font-bold tabular-nums"
            title={`The bank's clock runs ${daysAhead} day(s) ahead of today`}
            data-testid="bank-clock-ahead"
          >
            +{daysAhead} d
          </span>
        ) : null}
      </div>

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={advance.pending || undefined}
        aria-label={
          advance.pending ? "Advancing the clock" : "Fast-forward the clock"
        }
        disabled={advance.pending}
        onClick={() => setOpen((value) => !value)}
        data-testid="bank-clock-fast-forward"
        className={cx(
          "outline-box press eyebrow flex h-9 items-center gap-1.5 rounded-sm px-2.5 font-bold",
          advance.pending ? "bg-brass/35" : "bg-federal-blue text-paper",
          "disabled:translate-none disabled:cursor-wait disabled:shadow-none",
        )}
      >
        {advance.pending ? (
          <>
            <Spinner />
            <span className="hidden sm:inline">Advancing…</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">▶▶</span>
            <span className="hidden sm:inline xl:hidden 2xl:inline">
              Fast-forward
            </span>
          </>
        )}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Fast-forward the bank's clock"
          className="outline-box absolute top-full right-0 z-40 mt-2 w-[min(17rem,calc(100vw-1.5rem))] rounded-sm bg-paper shadow-hard-md"
        >
          <p className="eyebrow border-ink border-b-2 px-3 py-2 text-[0.65rem] font-bold text-ink-muted">
            Fast-forward
          </p>
          <ul className="divide-y divide-ink/10">
            {JUMPS.map((item) => {
              const blocked = item.days > room;
              return (
                <li key={item.days}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={blocked}
                    onClick={() => void jump(item.days)}
                    data-testid={`bank-clock-jump-${item.days}`}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-morning-haze disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="font-mono text-sm font-bold">
                      {item.label}
                    </span>
                    <span className="text-xs text-ink-muted tabular-nums">
                      {date
                        ? `to ${formatDate(addDays(date, item.days))}`
                        : "hint" in item
                          ? item.hint
                          : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-ink border-t-2 bg-marble px-3 py-2 text-xs text-ink-muted">
            Each day crossed runs end-of-day: cards settle, scheduled payments
            run, loans are collected, interest accrues. Watch it in Operations.
            {room < 31 ? ` The clock may run ${room} more day(s) ahead.` : ""}
          </p>
        </div>
      ) : null}

      {!open && (advance.error || (shown && advance.outcome)) ? (
        <div className="absolute top-full right-0 z-30 mt-2 w-[min(22rem,calc(100vw-1.5rem))] shadow-hard-md">
          <button
            type="button"
            onClick={() => (advance.error ? advance.reset() : setShown(false))}
            className="block w-full text-left"
            title="Dismiss"
            data-testid="bank-clock-outcome"
          >
            {advance.error ? (
              <ErrorNote>{advance.error}</ErrorNote>
            ) : (
              <Notice className="border-ivy bg-paper text-ivy">
                {advance.outcome?.message}
              </Notice>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
