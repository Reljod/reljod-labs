"use client";

import type { Destination } from "../domain/api";
import { signOut } from "./api";
import { useLeave } from "./use-leave";
import { useWrite } from "./use-write";

/**
 * Ends this browser's session, once: the button waits while it signs out,
 * then the next page loads in full so nothing of this account stays on screen.
 */
export function SignOutButton({
  className,
  label = "Sign out",
  role,
}: {
  className: string;
  label?: string;
  role?: "menuitem";
}) {
  const { run, pending, outcome } = useWrite<Destination>();
  const busy = useLeave(outcome?.ok ? outcome.value : null) || pending;
  return (
    <div>
      <button
        type="button"
        role={role}
        disabled={busy}
        aria-busy={busy}
        onClick={() => void run(signOut)}
        className={`${className} disabled:opacity-50`}
      >
        {busy ? "Signing out…" : label}
      </button>
      {outcome && !outcome.ok ? (
        <p role="alert" className="mt-1 text-sm text-seal-red">
          {outcome.error}
        </p>
      ) : null}
    </div>
  );
}
