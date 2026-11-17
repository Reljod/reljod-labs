"use client";

import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/*
 * Sieve's small set of primitives: a thin-ruled panel, a button that knows
 * when its write is running, a tag and a confirm dialog. Colours and type
 * come from the site's tokens in src/app/globals.css.
 */

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-3.5 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin",
        className,
      )}
    />
  );
}

/** A bordered surface with an optional header row. */
export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cx(
        "min-w-0 rounded-sm border border-ink/15 bg-paper",
        className,
      )}
    >
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
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary:
    "border border-federal-blue bg-federal-blue text-paper hover:border-ink hover:bg-ink",
  secondary:
    "border border-ink/25 bg-paper text-ink hover:border-ink/50 hover:bg-marble",
  ghost:
    "border border-transparent text-ink-muted hover:bg-marble hover:text-ink",
  danger:
    "border border-seal-red bg-seal-red text-paper hover:border-ink hover:bg-ink",
};

const SIZE = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
} as const;

/**
 * A button. For one that writes, pass `pending` and a `pendingLabel`: while
 * the write runs it is disabled, says so and is `aria-busy`, so it cannot
 * fire twice. Show the result beside it.
 */
export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  pendingLabel,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof SIZE;
  pending?: boolean;
  pendingLabel?: string;
}) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {pending ? <Spinner /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

const TAG_TONE = {
  neutral: "border-ink/20 bg-marble text-ink",
  blue: "border-federal-blue/30 bg-morning-haze text-federal-blue",
  brass: "border-oak/30 bg-brass/25 text-oak",
  green: "border-ivy/30 bg-ivy/10 text-ivy",
  red: "border-seal-red/30 bg-seal-red/10 text-seal-red",
  ink: "border-ink bg-ink text-paper",
} as const;
export type TagTone = keyof typeof TAG_TONE;

export function Tag({
  tone = "neutral",
  children,
  title,
}: {
  tone?: TagTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[0.68rem] font-medium whitespace-nowrap",
        TAG_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

export const fieldClass =
  "h-9 min-w-0 rounded-sm border border-ink/25 bg-paper px-2 text-sm text-ink focus-visible:border-federal-blue focus-visible:outline-2 focus-visible:outline-federal-blue/30 disabled:bg-marble disabled:text-ink-muted";

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-seal-red">
      {children}
    </p>
  );
}

/**
 * A write that runs once at a time. `pending` shows on the next render, so a
 * ref turns a second click away at once.
 */
export function useWrite<A extends unknown[], R>(
  write: (...args: A) => Promise<R>,
) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = async (...args: A): Promise<R | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await write(...args);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { run, pending };
}

/**
 * Asks before a destructive or hard-to-undo write, sends it once (the
 * button is disabled while it runs) and shows the error inline. Escape and
 * the backdrop close it, except while the write runs. Same pattern as the
 * Guest pass page's ConfirmDialog.
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
  children: ReactNode;
  confirm: string;
  pendingLabel: string;
  danger?: boolean;
  /** Resolves to an error message, or null when it worked (the dialog then closes). */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const write = useWrite(async () => {
    setError(null);
    const problem = await onConfirm().catch((caught: unknown) =>
      caught instanceof Error ? caught.message : "That did not work.",
    );
    if (problem) setError(problem);
    else onClose();
  });

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const tryClose = () => {
    if (!write.pending) onClose();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape closes it from the keyboard (onCancel)
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        tryClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) tryClose();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-sm border border-ink/20 bg-paper p-0 text-ink shadow-hard-md backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-4 p-5">
        <h3
          id={`${id}-title`}
          className="font-mono text-base font-bold uppercase"
        >
          {title}
        </h3>
        <p className="text-sm">{children}</p>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={danger ? "danger" : "primary"}
            pending={write.pending}
            pendingLabel={pendingLabel}
            onClick={() => void write.run()}
          >
            {confirm}
          </Button>
          <Button onClick={tryClose} disabled={write.pending}>
            Cancel
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Now, every second while `live`. Starts at 0 and reads the clock only after
 * mount: a Client Component prerenders on the server, where a clock read in
 * render would land in the static shell.
 */
export function useNow(live: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}
