"use client";

import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { ROLE_LABEL, type Role } from "../domain/staff";
import { useWrite } from "./use-write";

export { Markdown } from "./markdown";
export { useWrite } from "./use-write";

/*
 * The Harness's shared primitives. Every tab builds from these so the app
 * reads as one product: dense, calm, a bank back office. Colours and type
 * come from the site's tokens in src/app/globals.css; borders are a thin ink
 * line rather than the landing page's 2px outline.
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
    <Tag className={cx("rounded-sm border border-ink/15 bg-paper", className)}>
      {title || eyebrow || actions ? (
        <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-ink/10 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <p className="eyebrow text-[0.65rem] text-ink-muted">{eyebrow}</p>
            ) : null}
            {title ? (
              <h2 className="truncate text-sm font-semibold">{title}</h2>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
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

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border border-federal-blue bg-federal-blue text-paper hover:border-ink hover:bg-ink",
  secondary:
    "border border-ink/25 bg-paper text-ink hover:border-ink/50 hover:bg-marble",
  ghost:
    "border border-transparent text-ink-muted hover:bg-marble hover:text-ink",
  danger:
    "border border-seal-red bg-seal-red text-paper hover:border-ink hover:bg-ink",
};

const BUTTON_SIZE = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
} as const;

export const buttonClass = (
  variant: ButtonVariant = "secondary",
  size: keyof typeof BUTTON_SIZE = "md",
) =>
  cx(
    "inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
    "disabled:cursor-not-allowed disabled:opacity-55",
    BUTTON_VARIANT[variant],
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

const TONE: Record<Tone, string> = {
  neutral: "border-ink/15 bg-marble text-ink-muted",
  blue: "border-federal-blue/30 bg-morning-haze text-federal-blue",
  green: "border-ivy/30 bg-ivy/10 text-ivy",
  amber: "border-brass/60 bg-brass/15 text-oak",
  red: "border-seal-red/30 bg-seal-red/10 text-seal-red",
  ink: "border-ink bg-ink text-paper",
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
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 font-mono text-[0.65rem] font-medium tracking-[0.06em] whitespace-nowrap uppercase",
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

/** A Staff member's Role: an admin stands out, a user is quiet. */
export function RoleBadge({
  role,
  className = "",
}: {
  role: Role;
  className?: string;
}) {
  return (
    <Badge tone={role === "admin" ? "ink" : "neutral"} className={className}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

/** A Staff member's initials in a square, as the Audit trail and the chat show who acted. */
export function Initials({
  initials,
  role = "user",
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
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm border font-mono text-[0.65rem] font-bold",
        role === "admin"
          ? "border-ink bg-ink text-paper"
          : "border-ink/25 bg-morning-haze text-ink",
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
      <p className="text-sm font-semibold">{title}</p>
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
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-seal-red/30 bg-seal-red/5 px-3 py-2 text-sm text-seal-red",
        className,
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline underline-offset-2"
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
        "rounded-sm border border-ivy/30 bg-ivy/5 px-3 py-2 text-sm text-ivy",
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
        <div key={key} className="hx-shimmer h-9 rounded-sm" />
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
      <div className="w-full max-w-md rounded-sm border border-ink/20 border-dashed bg-paper/60 px-6 py-10 text-center">
        <p className="eyebrow text-[0.65rem] text-ink-muted">Coming</p>
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
  "w-full rounded-sm border border-ink/25 bg-paper px-2.5 py-1.5 text-sm text-ink placeholder:text-stone focus-visible:border-federal-blue focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-federal-blue/30 disabled:bg-marble disabled:text-ink-muted aria-[invalid=true]:border-seal-red";

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
        className="eyebrow text-[0.65rem] text-ink-muted"
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
      className={cx("hx-scroll-x flex items-stretch gap-1", className)}
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
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 font-medium whitespace-nowrap transition-colors",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-federal-blue",
              size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2.5 text-sm",
              selected
                ? "border-federal-blue text-ink"
                : "border-transparent text-ink-muted hover:border-ink/20 hover:text-ink",
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
        "hx-dialog m-auto max-h-[calc(100dvh-2rem)] rounded-sm border border-ink/30 bg-paper p-0 text-ink shadow-hard-md",
        wide
          ? "w-[min(44rem,calc(100vw-2rem))]"
          : "w-[min(28rem,calc(100vw-2rem))]",
      )}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header className="flex items-center gap-3 border-ink/10 border-b px-5 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 text-sm font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={tryClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-sm px-1.5 text-lg leading-none text-ink-muted hover:bg-marble hover:text-ink disabled:opacity-40"
          >
            ×
          </button>
        </header>
        <div className="hx-scroll min-h-0 flex-1 px-5 py-4 text-sm">
          {children}
        </div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-ink/10 border-t px-5 py-3">
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
