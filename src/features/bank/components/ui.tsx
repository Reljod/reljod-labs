"use client";

import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { demoTabClass } from "@/components/demo/demo-bar-styles";
import { ROLE_LABEL, type Role } from "../domain/staff";
import { useWrite } from "./use-write";

export { Markdown } from "./markdown";
export { useWrite } from "./use-write";

/*
 * The Harness's shared primitives. Every tab builds from these so the app
 * reads as one product, and as a sibling of the other demos: the Colonnade
 * language of src/app/globals.css (2px ink outlines with `outline-box`, hard
 * offset shadows, `press` on everything clickable, mono `eyebrow` labels and
 * the site's colour tokens). Inner rules between rows stay a thin ink line.
 */

const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export { cx };

// Spinner ------------------------------------------------------------------------

export function Spinner({
  className = "",
  label,
}: {
  className?: string;
  /** Read out to screen readers; leave it off when text beside it already says so. */
  label?: string;
}) {
  return (
    <span className="inline-flex shrink-0">
      <span
        aria-hidden="true"
        className={cx(
          "inline-block size-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin",
          className,
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

// Panel --------------------------------------------------------------------------

/** A bordered surface with an optional header row. The unit every tab is laid out in. */
export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
  as: Tag = "section",
}: {
  title?: ReactNode;
  /** A small mono label above the title. */
  eyebrow?: ReactNode;
  /** Buttons on the right of the header. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Padding of the body; pass "" for a list or table that runs edge to edge. */
  bodyClassName?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  return (
    <Tag
      className={cx(
        "outline-box rounded-sm bg-paper shadow-hard-sm",
        className,
      )}
    >
      {title || eyebrow || actions ? (
        <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-ink border-b-2 px-4 py-2">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <p className="eyebrow text-[0.65rem] font-bold text-ink-muted">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="truncate font-mono text-sm font-bold tracking-[0.04em] uppercase">
                {title}
              </h2>
            ) : null}
          </div>
          {actions ? (
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}
      {children !== undefined ? (
        <div className={bodyClassName}>{children}</div>
      ) : null}
    </Tag>
  );
}

// Button -------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

// Every variant is an ink-outlined box that presses; only the fill changes.
// A ghost is the quiet one: no fill, muted text, a smaller shadow.
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "press bg-federal-blue text-paper",
  secondary: "press bg-paper text-ink hover:bg-morning-haze",
  ghost: "press shadow-hard-sm bg-marble text-ink-muted hover:text-ink",
  danger: "press bg-seal-red text-paper",
};

const BUTTON_SIZE = {
  sm: "h-8 gap-1.5 px-2.5 text-[0.7rem]",
  md: "h-9 gap-2 px-3.5 text-xs",
} as const;

export const buttonClass = (
  variant: ButtonVariant = "secondary",
  size: keyof typeof BUTTON_SIZE = "md",
) =>
  cx(
    "outline-box inline-flex shrink-0 items-center justify-center rounded-sm font-mono font-bold tracking-[0.08em] whitespace-nowrap uppercase",
    BUTTON_VARIANT[variant],
    // A disabled button stops pressing but keeps its title (no pointer-events-none).
    "disabled:translate-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
    BUTTON_SIZE[size],
  );

/**
 * The Harness's button. For a button that writes, pass `pending` (from
 * `useWrite`, `useMutation` or `useActionState`) and a `pendingLabel`: while
 * the write runs it is disabled, says "Saving…" and is `aria-busy`, so it
 * cannot fire twice. Show the result or the error beside it (`ErrorNote`).
 */
export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  pendingLabel,
  icon,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZE;
  /** The write this button starts is running. */
  pending?: boolean;
  /** What it says while pending: "Saving…". */
  pendingLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(buttonClass(variant, size), className)}
    >
      {pending ? <Spinner /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

// Badges -------------------------------------------------------------------------

export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "ink";

// Stamped like the bar's badge: a 1px ink edge, a flat fill, mono caps.
const TONE: Record<Tone, string> = {
  neutral: "bg-marble text-ink-muted",
  blue: "bg-morning-haze text-federal-blue",
  green: "bg-ivy/15 text-ivy",
  amber: "bg-brass/35 text-ink",
  red: "bg-seal-red/10 text-seal-red",
  ink: "bg-ink text-paper",
};

/** A small label for a state: a Run's status, an Outcome, a Version. */
export function Badge({
  tone = "neutral",
  children,
  className = "",
  dot = false,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  /** A dot before the text, pulsing: for something at work. */
  dot?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-ink px-1.5 font-mono text-[0.65rem] font-bold tracking-[0.06em] whitespace-nowrap uppercase",
        TONE[tone],
        className,
      )}
    >
      {dot ? (
        <span
          className="hx-pulse size-1.5 rounded-full bg-current"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

/** A Staff member's Role: a supervisor stands out, the others are quiet. */
export function RoleBadge({
  role,
  className = "",
}: {
  role: Role;
  className?: string;
}) {
  return (
    <Badge
      tone={role === "supervisor" ? "ink" : "neutral"}
      className={className}
    >
      {ROLE_LABEL[role]}
    </Badge>
  );
}

/** A Staff member's initials in a square, as the Audit trail and the chat show who acted. */
export function Initials({
  initials,
  role = "teller",
  className = "",
}: {
  initials: string;
  role?: Role;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm border-2 border-ink font-mono text-[0.65rem] font-bold",
        role === "supervisor"
          ? "bg-ink text-paper"
          : "bg-morning-haze text-ink",
        className,
      )}
    >
      {initials}
    </span>
  );
}

// Empty, errors, loading ---------------------------------------------------------

/** What a list or a pane shows when there is nothing in it yet. */
export function Empty({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
    >
      <p className="font-mono text-sm font-bold tracking-[0.04em] uppercase">
        {title}
      </p>
      {children ? (
        <p className="max-w-sm text-sm text-ink-muted">{children}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** An error, shown where it happened. Renders nothing without a message. */
export function ErrorNote({
  children,
  className = "",
  onRetry,
}: {
  children?: ReactNode;
  className?: string;
  onRetry?: () => void;
}) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={cx(
        "outline-box flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border-seal-red bg-paper px-3 py-2 text-sm text-seal-red",
        className,
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="outline-box press eyebrow rounded-sm bg-paper px-2 py-0.5 font-bold text-ink shadow-hard-sm"
        >
          Try again
        </button>
      ) : null}
    </p>
  );
}

/** A note that something worked, shown where it was clicked. */
export function DoneNote({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p
      aria-live="polite"
      className={cx(
        "outline-box rounded-sm border-ivy bg-paper px-3 py-2 text-sm text-ivy",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Placeholder rows while something loads. */
export function Loading({
  rows = 3,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={cx("space-y-2", className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, row) => `row-${row}`).map((key) => (
        <div
          key={key}
          className="hx-shimmer h-9 rounded-sm border-2 border-ink/20"
        />
      ))}
    </div>
  );
}

/** What a tab shows until its slice lands. */
export function ComingPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md rounded-sm border-2 border-ink border-dashed bg-paper px-6 py-10 text-center">
        <p className="eyebrow text-[0.65rem] font-bold text-ink-muted">
          Coming
        </p>
        <h2 className="mt-2 font-mono text-base font-bold uppercase">
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

// Field --------------------------------------------------------------------------

export const inputClass =
  "outline-box w-full rounded-sm bg-paper px-2.5 py-1.5 text-sm text-ink shadow-hard-sm placeholder:text-stone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue disabled:bg-marble disabled:text-ink-muted disabled:shadow-none aria-[invalid=true]:border-seal-red";

/**
 * A labelled control. Give the control inside the `id` you pass as `htmlFor`,
 * and `aria-invalid` when `error` is set; style inputs with `inputClass`.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = "",
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label
        htmlFor={htmlFor}
        className="eyebrow text-[0.65rem] font-bold text-ink-muted"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-seal-red">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

// Tabs ---------------------------------------------------------------------------

export type TabItem<Id extends string> = {
  id: Id;
  label: string;
  /** A count or a mark after the label: open Conflicts, pending Approvals. */
  badge?: ReactNode;
};

/**
 * A strip of tabs. Arrow keys move between them, as a tablist should. The
 * panel it controls takes `role="tabpanel"` and `aria-labelledby` the tab's
 * id: `${idPrefix}-${tab.id}`.
 */
export function Tabs<Id extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  size = "md",
  className = "",
}: {
  tabs: TabItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** What these tabs choose between, for screen readers. */
  label: string;
  idPrefix: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const edge =
      event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (step === 0 && edge === null) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === value);
    const next = tabs[edge ?? (index + step + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.id);
    document.getElementById(`${idPrefix}-${next.id}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("flex flex-wrap items-center gap-2", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cx(
              demoTabClass(selected),
              "shrink-0 whitespace-nowrap",
              size === "sm" && "h-8 px-2.5 text-[0.7rem] shadow-hard-sm",
            )}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

// Segments -----------------------------------------------------------------------

/** A row of pressed/unpressed choices (`aria-pressed` buttons): the bar's tab boxes, small. */
export const segmentsClass = "flex flex-wrap items-center gap-1.5";

/**
 * One choice in a row of segments. `fill` replaces the ink of the chosen one
 * (a Rule's Block in seal red). Disabled ones stop pressing and keep their title.
 */
export const segmentClass = (active: boolean, fill = "bg-ink text-paper") =>
  cx(
    "outline-box press eyebrow inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[0.65rem] font-bold whitespace-nowrap shadow-hard-sm",
    active ? fill : "bg-paper text-ink hover:bg-morning-haze",
    "disabled:translate-none disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
  );

// Dialogs ------------------------------------------------------------------------

/**
 * A modal on the native `<dialog>`: it traps focus and Escape closes it.
 * Escape and a click on the backdrop do nothing while `busy` (a write is
 * running), so a person cannot walk away from a write half made.
 */
export function Dialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  /** Buttons along the bottom. */
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const tryClose = () => {
    if (!busy) onClose();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape closes it from the keyboard (onCancel)
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        tryClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) tryClose();
      }}
      className={cx(
        "hx-dialog outline-box m-auto max-h-[calc(100dvh-2rem)] rounded-sm bg-paper p-0 text-ink shadow-hard-lg",
        wide
          ? "w-[min(44rem,calc(100vw-2rem))]"
          : "w-[min(28rem,calc(100vw-2rem))]",
      )}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="flex items-center gap-3 border-ink border-b-2 px-5 py-3">
          <h2
            id={titleId}
            className="min-w-0 flex-1 font-mono text-sm font-bold tracking-[0.04em] uppercase"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={tryClose}
            disabled={busy}
            aria-label="Close"
            className="outline-box press grid size-8 shrink-0 place-items-center rounded-sm bg-paper text-lg leading-none shadow-hard-sm disabled:translate-none disabled:opacity-40 disabled:shadow-none"
          >
            ×
          </button>
        </header>
        <div className="hx-scroll min-h-0 flex-1 px-5 py-4 text-sm">
          {children}
        </div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-ink border-t-2 bg-marble px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}

/**
 * Asks before a write that is destructive or hard to undo, sends it once,
 * then says what happened where it was asked. `onConfirm` does the write: if
 * it resolves to a message the dialog shows it with a Done button; if it
 * resolves to nothing the dialog closes; if it throws the error is shown and
 * the person may try again.
 */
export function ConfirmDialog({
  title,
  children,
  confirm,
  pendingLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  /** What will happen, in a sentence or two. */
  children: ReactNode;
  /** The confirm button's label: "Restore the Default". */
  confirm: string;
  /** What it says while the write runs: "Restoring…". */
  pendingLabel: string;
  danger?: boolean;
  // biome-ignore lint/suspicious/noConfusingVoidType: a write that returns nothing closes the dialog
  onConfirm: () => Promise<string | void>;
  onClose: () => void;
}) {
  const write = useWrite(async () => {
    const message = await onConfirm();
    if (!message) onClose();
    return message ?? null;
  });
  const done = typeof write.result === "string" ? write.result : null;
  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={write.pending}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={write.pending}>
              Cancel
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              pending={write.pending}
              pendingLabel={pendingLabel}
              onClick={() => void write.run()}
            >
              {confirm}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <DoneNote>{done}</DoneNote>
      ) : (
        <div className="space-y-3">
          <div className="text-ink-muted">{children}</div>
          <ErrorNote>{write.error}</ErrorNote>
        </div>
      )}
    </Dialog>
  );
}
