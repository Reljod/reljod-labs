"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  buttonClass,
  dangerButtonClass,
  InlineError,
  quietButtonClass,
} from "./ui";

/**
 * Asks before one write, sends it once, then says what changed. Escape and
 * the backdrop close it, except while the write runs. The pattern of
 * `ConfirmDialog` in `features/access/components/pass-actions.tsx`, for a
 * write that is a plain async call rather than a form action.
 */
export function ConfirmDialog({
  id,
  title,
  children,
  confirm,
  pending: pendingText,
  danger = false,
  onConfirm,
  onClose,
}: {
  id: string;
  title: string;
  children: ReactNode;
  confirm: string;
  pending: string;
  danger?: boolean;
  /** Runs the write; resolves to what changed, or throws/returns an error. */
  onConfirm: () => Promise<{ done: string } | { error: string }>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    // Focus goes back to whatever opened the dialog once it closes.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (element && !element.open) element.showModal();
    // A destructive dialog opens on Cancel, so a stray Enter does not confirm it.
    if (danger) cancel.current?.focus();
    return () => {
      element?.close();
      requestAnimationFrame(() => opener?.focus());
    };
  }, [danger]);

  const tryClose = () => {
    if (!busy.current) onClose();
  };

  const send = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm();
      if ("error" in result) setError(result.error);
      else setDone(result.done);
    } catch {
      setError("That did not reach the server. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
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
      className="outline-box m-auto w-[min(28rem,calc(100vw-2rem))] bg-paper p-0 text-ink shadow-hard-md backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-4 p-5">
        <h3
          id={`${id}-title`}
          className="font-mono text-base font-bold uppercase"
        >
          {title}
        </h3>
        {done ? (
          <div aria-live="polite" className="flex flex-col gap-3">
            <p className="font-semibold">{done}</p>
            <button
              type="button"
              onClick={onClose}
              className={`${buttonClass} self-start`}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="text-sm">{children}</div>
            <InlineError>{error}</InlineError>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={send}
                disabled={pending}
                aria-busy={pending}
                className={danger ? dangerButtonClass : buttonClass}
              >
                {pending ? pendingText : confirm}
              </button>
              <button
                type="button"
                onClick={tryClose}
                disabled={pending}
                ref={cancel}
                className={quietButtonClass}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
