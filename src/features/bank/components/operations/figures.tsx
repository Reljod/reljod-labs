"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { formatMinor, formatMoney } from "../../domain/money";
import { Block } from "../shell/tab-loading";
import { cx, ErrorNote } from "../ui";

/** How a section of a tab reads while it is the visible tab: live, polled. */
export type Live = { enabled: boolean; refetchMs: number | false };

export const liveWhile = (visible: boolean, everyMs: number): Live => ({
  enabled: visible,
  refetchMs: visible ? everyMs : false,
});

/** An amount in a column: right-aligned, tabular, without the currency (the header names it). */
export function Amount({
  minor,
  className = "",
  blankZero = false,
}: {
  minor: number;
  className?: string;
  /** Show nothing for zero, as a debit/credit table does. */
  blankZero?: boolean;
}) {
  return (
    <span
      className={cx("font-mono tabular-nums", className)}
      title={formatMoney(minor)}
    >
      {blankZero && minor === 0 ? "" : formatMinor(minor)}
    </span>
  );
}

/** A number that rolls over when it changes, so a queue draining reads as moving. */
export function LiveNumber({
  value,
  className = "",
}: {
  value: number | string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      className={cx(
        "relative inline-flex overflow-hidden tabular-nums",
        className,
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={reduce ? { opacity: 0 } : { y: "-70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "70%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A big labelled figure, the unit of a tab's top strip. */
export function Figure({
  label,
  value,
  tone = "",
  hint,
  testId,
}: {
  label: string;
  value: number | string;
  tone?: string;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="outline-box rounded-sm bg-paper px-3 py-2 shadow-hard-sm"
      data-testid={testId}
    >
      <p className="eyebrow text-[0.6rem] font-bold text-ink-muted">{label}</p>
      <p className={cx("font-mono text-2xl font-bold sm:text-3xl", tone)}>
        <LiveNumber value={value} />
      </p>
      {hint ? <p className="text-[0.7rem] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** Rows shaped like a list that is still loading, with a status for screen readers. */
export function ListSkeleton({
  rows = 4,
  label,
  height = "h-14",
}: {
  rows?: number;
  label: string;
  height?: string;
}) {
  return (
    <div aria-busy="true" className="space-y-2 p-3">
      <output aria-live="polite" className="sr-only">
        {label}
      </output>
      {Array.from({ length: rows }, (_, row) => `row-${row}`).map((key) => (
        <Block key={key} className={cx(height, "w-full")} />
      ))}
    </div>
  );
}

/** A read that failed, with a way to try again. */
export function ReadError({
  error,
  onRetry,
}: {
  error: { message: string } | null;
  onRetry: () => void;
}) {
  return (
    <div className="p-3">
      <ErrorNote onRetry={onRetry}>
        {error?.message ?? "Could not read this."}
      </ErrorNote>
    </div>
  );
}
