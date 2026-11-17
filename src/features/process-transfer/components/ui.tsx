"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";

/*
 * Small pieces every Handover tab uses, in the Colonnade vocabulary: ink
 * outlines, hard shadows, mono eyebrows, ivy for pass and seal red for fail.
 */

const buttonBase =
  "outline-box press inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 py-2 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-x-0 disabled:hover:translate-y-0";

export const buttonClass = `${buttonBase} bg-federal-blue`;

export const dangerButtonClass = `${buttonBase} bg-seal-red`;

export const quietButtonClass =
  "outline-box press inline-flex min-h-9 items-center justify-center gap-1.5 rounded-sm bg-paper px-3 font-mono text-xs font-bold tracking-[0.1em] text-ink uppercase disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-x-0 disabled:hover:translate-y-0";

export const linkButtonClass =
  "rounded-sm font-medium text-federal-blue underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue";

export const fieldClass =
  "outline-box min-h-10 w-full rounded-sm bg-paper px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue disabled:opacity-60";

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue";

/** A boxed panel on paper, with an optional eyebrow heading and actions on the right. */
export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`outline-box min-w-0 rounded-sm bg-paper shadow-hard-sm ${className}`}
    >
      {title || eyebrow || actions ? (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-ink border-b-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <p className="eyebrow text-ink-muted">{eyebrow}</p>
            ) : null}
            {title ? (
              <h3 className="font-mono text-sm font-bold tracking-[0.06em] uppercase">
                {title}
              </h3>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  /** A short count or state after the label ("3", "Held"). */
  badge?: ReactNode;
  disabled?: boolean;
};

/**
 * A row of tabs with the ARIA tabs pattern: arrow keys, Home and End move
 * between them and select. Panels use `tabPanelProps`.
 */
export function Tabs<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  variant = "page",
  className = "",
}: {
  id: string;
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  variant?: "page" | "inner";
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((item) => !item.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((item) => item.id === value);
    let next: TabItem<T> | undefined;
    if (event.key === "ArrowRight")
      next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft")
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled.at(-1);
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    refs.current[next.id]?.focus();
  };

  const page = variant === "page";
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex max-w-full gap-1 overflow-x-auto ${page ? "" : "border-ink border-b-2"} ${className}`}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(element) => {
              refs.current[item.id] = element;
            }}
            id={`${id}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? `${id}-panel-${item.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={
              page
                ? `flex min-h-10 shrink-0 items-center gap-1.5 rounded-sm px-2 font-mono sm:gap-2 sm:px-3 text-xs font-bold tracking-[0.1em] uppercase transition-colors ${focusRing} ${selected ? "bg-ink text-paper" : "text-ink-muted hover:bg-limestone hover:text-ink"} disabled:opacity-40`
                : `-mb-0.5 flex min-h-10 shrink-0 items-center gap-2 border-b-4 px-3 font-mono text-xs font-bold tracking-[0.1em] uppercase transition-colors ${focusRing} ${selected ? "border-federal-blue text-ink" : "border-transparent text-ink-muted hover:text-ink"} disabled:opacity-40`
            }
          >
            {item.label}
            {item.badge !== undefined && item.badge !== null ? (
              <span
                className={`rounded-sm px-1.5 py-px text-[10px] ${selected && page ? "bg-paper/20" : "bg-limestone text-ink"}`}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(id: string, tab: string) {
  return {
    role: "tabpanel" as const,
    id: `${id}-panel-${tab}`,
    "aria-labelledby": `${id}-tab-${tab}`,
    tabIndex: 0,
    className: `min-w-0 ${focusRing}`,
  };
}

type MarkTone = "pass" | "fail" | "warn" | "running" | "pending" | "skipped";

const MARK: Record<
  MarkTone,
  { glyph: string; className: string; label: string }
> = {
  pass: { glyph: "✓", className: "bg-ivy text-paper", label: "Passed" },
  fail: { glyph: "✕", className: "bg-seal-red text-paper", label: "Failed" },
  warn: { glyph: "!", className: "bg-brass text-ink", label: "Warning" },
  running: {
    glyph: "",
    className: "bg-federal-blue text-paper",
    label: "Running",
  },
  pending: {
    glyph: "",
    className: "bg-paper text-ink-muted",
    label: "Waiting",
  },
  skipped: {
    glyph: "–",
    className: "bg-limestone text-ink-muted",
    label: "Skipped",
  },
};

/** A square mark: ✓ ivy, ✕ seal red, ! brass, a pulsing dot while running. */
export function StatusMark({
  tone,
  label,
  size = "md",
}: {
  tone: MarkTone;
  label?: string;
  size?: "sm" | "md";
}) {
  const mark = MARK[tone];
  return (
    <span
      role="img"
      aria-label={label ?? mark.label}
      className={`outline-box inline-flex shrink-0 items-center justify-center rounded-sm font-mono font-bold ${size === "sm" ? "size-5 text-[11px]" : "size-7 text-sm"} ${mark.className}`}
    >
      {tone === "running" ? (
        <span className="ho-pulse size-2 rounded-full bg-paper" />
      ) : (
        mark.glyph
      )}
    </span>
  );
}

/** An error where the person clicked. */
export function InlineError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm font-medium text-seal-red">
      {children}
    </p>
  );
}

/** A quiet confirmation where the person clicked. */
export function InlineNote({
  children,
  tone = "ok",
}: {
  children: ReactNode;
  tone?: "ok" | "muted";
}) {
  if (!children) return null;
  return (
    <p
      aria-live="polite"
      className={`text-sm ${tone === "ok" ? "font-medium text-ivy" : "text-ink-muted"}`}
    >
      {children}
    </p>
  );
}

/** Grey bars while something loads. */
export function Skeleton({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder bars have no identity
          key={index}
          className="ho-shimmer h-3 rounded-sm"
          style={{ width: `${92 - ((index * 17) % 40)}%` }}
        />
      ))}
    </div>
  );
}

/** A centred message for a tab with nothing in it yet. */
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-sm border-2 border-ink/30 border-dashed bg-paper/60 p-6">
      <p className="font-mono text-sm font-bold tracking-[0.06em] uppercase">
        {title}
      </p>
      {children ? (
        <div className="text-sm text-ink-muted">{children}</div>
      ) : null}
      {action}
    </div>
  );
}
