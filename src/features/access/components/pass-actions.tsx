"use client";

import { useActionState, useState } from "react";
import {
  durationLabel,
  type GuestPassStatus,
  LIMITS,
} from "../domain/guest-pass";
import {
  deleteGuestPass,
  extendGuestPass,
  type NewCodeState,
  regenerateGuestCode,
  restoreGuestPass,
  revokeGuestPass,
} from "../server/actions";
import { fieldClass, quietButtonClass } from "./styles";

/**
 * What a Host can do with one issued Guest pass: extend or renew it, give it
 * a new Guest code, revoke it, delete it, or restore it once deleted.
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
  const [state, regenerate, pending] = useActionState<NewCodeState, FormData>(
    regenerateGuestCode,
    null,
  );
  const [copied, setCopied] = useState(false);
  const issued = state && "code" in state ? state : null;

  if (status === "deleted") {
    return (
      <form action={restoreGuestPass}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className={quietButtonClass}>
          Restore
        </button>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <form action={extendGuestPass} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`extend-${id}`} className="sr-only">
            {status === "live" ? "Extend by" : "Renew for"}
          </label>
          <select
            id={`extend-${id}`}
            name="hours"
            defaultValue={LIMITS.defaultDurationHours}
            className={`${fieldClass} min-h-9 w-auto py-1 text-sm`}
          >
            {LIMITS.durationsHours.map((hours) => (
              <option key={hours} value={hours}>
                {durationLabel(hours)}
              </option>
            ))}
          </select>
          <button type="submit" className={quietButtonClass}>
            {status === "live" ? "Extend" : "Renew"}
          </button>
        </form>
        <form action={regenerate} onSubmit={() => setCopied(false)}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={pending}
            className={quietButtonClass}
            title="Signs out every device on the old code. Saved data stays."
          >
            {pending ? "Making…" : "New code"}
          </button>
        </form>
        {status === "live" ? (
          <form action={revokeGuestPass}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className={quietButtonClass}>
              Revoke
            </button>
          </form>
        ) : null}
        <form
          action={deleteGuestPass}
          onSubmit={(event) => {
            if (
              !window.confirm(
                `Delete the pass for ${label}? Its guests lose access now. The pass and what they saved are kept ${LIMITS.retentionDays} days, then deleted for good.`,
              )
            )
              event.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={`${quietButtonClass} text-seal-red`}>
            Delete
          </button>
        </form>
      </div>

      {state && "error" in state ? (
        <p role="alert" className="text-sm text-seal-red">
          {state.error}
        </p>
      ) : null}
      {issued ? (
        <div
          aria-live="polite"
          data-testid="new-code"
          className="outline-box bg-morning-haze p-3 shadow-hard-sm"
        >
          <p className="eyebrow">New guest code for {issued.label}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="font-mono text-xl font-bold tracking-[0.15em]">
              {issued.code}
            </p>
            <button
              type="button"
              className={quietButtonClass}
              onClick={async () => {
                await navigator.clipboard.writeText(issued.code);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-sm">
            Shown once. The old code no longer works; devices on it must enter
            this one. Their saved data is kept.
          </p>
        </div>
      ) : null}
    </div>
  );
}
