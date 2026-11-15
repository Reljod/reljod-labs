"use client";

import { useActionState } from "react";
import { useSubmitGuard } from "@/components/ui/use-submit-guard";
import { signOut } from "../server/actions";
import { useLeave } from "./use-leave";

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
  const [state, action, pending] = useActionState<{ to: string } | null>(
    () => signOut(),
    null,
  );
  const guard = useSubmitGuard(pending, state);
  const busy = useLeave(state) || pending;
  return (
    <form action={action} onSubmit={guard}>
      <button
        type="submit"
        role={role}
        disabled={busy}
        aria-busy={busy}
        className={`${className} disabled:opacity-50`}
      >
        {busy ? "Signing out…" : label}
      </button>
    </form>
  );
}
