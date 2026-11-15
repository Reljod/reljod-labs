"use client";

import {
  type ReactNode,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  durationLabel,
  type GuestPassStatus,
  LIMITS,
} from "../domain/guest-pass";
import {
  deleteGuestPass,
  extendGuestPass,
  type PassActionState,
  regenerateGuestCode,
  restoreGuestPass,
  revokeGuestPass,
} from "../server/actions";
import { LocalTime } from "./local-time";
import { fieldClass, quietButtonClass, submitClass } from "./styles";

type PassAction = (
  previous: PassActionState,
  form: FormData,
) => Promise<PassActionState>;

type Kind = "extend" | "code" | "revoke" | "delete" | "restore";

/**
 * What a Host can do with one issued Guest pass. Every action writes, so each
 * asks first in a dialog, can be sent only once while it runs, and says what
 * changed before the dialog closes.
 */
export function PassActions({
  id,
  label,
  status,
}: {
  id: string;
  label: string;
  status: GuestPassStatus;
}) {
  const [open, setOpen] = useState<Kind | null>(null);
  // A fresh dialog (and action state) every time one opens.
  const [opened, setOpened] = useState(0);
  const show = (kind: Kind) => {
    setOpened((count) => count + 1);
    setOpen(kind);
  };
  const close = () => setOpen(null);
  const renew = status !== "live";

  const buttons: { kind: Kind; text: string; danger?: boolean }[] =
    status === "deleted"
      ? [{ kind: "restore", text: "Restore" }]
      : [
          { kind: "extend", text: renew ? "Renew" : "Extend" },
          { kind: "code", text: "New code" },
          ...(status === "live"
            ? [{ kind: "revoke" as const, text: "Revoke" }]
            : []),
          { kind: "delete", text: "Delete", danger: true },
        ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map((button) => (
          <button
            key={button.kind}
            type="button"
            onClick={() => show(button.kind)}
            className={`${quietButtonClass} ${button.danger ? "text-seal-red" : ""}`}
          >
            {button.text}
          </button>
        ))}
      </div>

      {open === "extend" ? (
        <ConfirmDialog
          key={opened}
          id={id}
          title={
            renew ? `Renew the pass for ${label}` : `Extend ${label}'s pass`
          }
          action={extendGuestPass}
          confirm={renew ? "Renew" : "Extend"}
          pending={renew ? "Renewing…" : "Extending…"}
          onClose={close}
          fields={
            <div className="flex flex-col gap-2">
              <label htmlFor={`extend-${id}`} className="eyebrow">
                {renew ? "Open again for" : "Add"}
              </label>
              <select
                id={`extend-${id}`}
                name="hours"
                defaultValue={LIMITS.defaultDurationHours}
                className={fieldClass}
              >
                {LIMITS.durationsHours.map((hours) => (
                  <option key={hours} value={hours}>
                    {durationLabel(hours)}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          {renew
            ? "Its guests can sign in again with the code they have, and find everything they saved."
            : "Added to the time it has left, up to 7 days from now."}
        </ConfirmDialog>
      ) : null}

      {open === "code" ? (
        <ConfirmDialog
          key={opened}
          id={id}
          title={`New code for ${label}`}
          action={regenerateGuestCode}
          confirm="Make a new code"
          pending="Making…"
          onClose={close}
        >
          The old code stops working and every device signed in with it is
          signed out. Whoever enters the new code gets the same saved data.
        </ConfirmDialog>
      ) : null}

      {open === "revoke" ? (
        <ConfirmDialog
          key={opened}
          id={id}
          title={`Revoke ${label}'s pass`}
          action={revokeGuestPass}
          confirm="Revoke"
          pending="Revoking…"
          danger
          onClose={close}
        >
          Its guests lose access now. Their saved data is kept, and renewing the
          pass lets them back in.
        </ConfirmDialog>
      ) : null}

      {open === "delete" ? (
        <ConfirmDialog
          key={opened}
          id={id}
          title={`Delete ${label}'s pass`}
          action={deleteGuestPass}
          confirm="Delete"
          pending="Deleting…"
          danger
          onClose={close}
        >
          Its guests lose access now. The pass and what they saved are kept{" "}
          {LIMITS.retentionDays} days so you can restore it, then deleted.
        </ConfirmDialog>
      ) : null}

      {open === "restore" ? (
        <ConfirmDialog
          key={opened}
          id={id}
          title={`Restore ${label}'s pass`}
          action={restoreGuestPass}
          confirm="Restore"
          pending="Restoring…"
          onClose={close}
        >
          It comes back as it was when deleted, with everything its guests
          saved. If it had ended, renew it to let them in.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/**
 * Asks before one write, sends it once (the button is disabled while it
 * runs), then shows what changed. Escape and the backdrop close it, except
 * while the write is running.
 */
function ConfirmDialog({
  id,
  title,
  children,
  fields,
  action,
  confirm,
  pending: pendingText,
  danger = false,
  onClose,
}: {
  id: string;
  title: string;
  children: ReactNode;
  fields?: ReactNode;
  action: PassAction;
  confirm: string;
  pending: string;
  danger?: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, send, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  const done = state && "done" in state ? state : null;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const tryClose = () => {
    if (!pending) onClose();
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
            <p className="font-semibold">
              {done.done}
              {done.expiresAt ? (
                <>
                  {" "}
                  Now until <LocalTime iso={done.expiresAt} />.
                </>
              ) : null}
            </p>
            {done.code ? (
              <div
                data-testid="new-code"
                className="outline-box bg-morning-haze p-3"
              >
                <p className="eyebrow">New guest code</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <p className="font-mono text-xl font-bold tracking-[0.15em]">
                    {done.code}
                  </p>
                  <button
                    type="button"
                    className={quietButtonClass}
                    onClick={async () => {
                      await navigator.clipboard.writeText(done.code ?? "");
                      setCopied(true);
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 text-sm">
                  Copy it now: it is shown once and cannot be looked up again.
                </p>
              </div>
            ) : null}
            <button type="button" onClick={onClose} className={submitClass}>
              Done
            </button>
          </div>
        ) : (
          <form action={send} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm">{children}</p>
            {fields}
            {state && "error" in state ? (
              <p role="alert" className="text-sm text-seal-red">
                {state.error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={pending}
                aria-busy={pending}
                className={`${submitClass} ${danger ? "bg-seal-red" : ""}`}
              >
                {pending ? pendingText : confirm}
              </button>
              <button
                type="button"
                onClick={tryClose}
                disabled={pending}
                className={`${quietButtonClass} disabled:opacity-50`}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
