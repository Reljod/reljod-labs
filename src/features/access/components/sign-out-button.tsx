"use client";

import { useActionState } from "react";
import { useSubmitGuard } from "@/components/ui/use-submit-guard";
import { signOut } from "../server/actions";

/** Ends this browser's session, once: the button waits while it signs out. */
export function SignOutButton({
  className,
  label = "Sign out",
  role,
}: {
  className: string;
  label?: string;
  role?: "menuitem";
}) {
  const [state, action, pending] = useActionState(async () => {
    await signOut();
    return null;
  }, null);
  const guard = useSubmitGuard(pending, state);
  return (
    <form action={action} onSubmit={guard}>
      <button
        type="submit"
        role={role}
        disabled={pending}
        aria-busy={pending}
        className={`${className} disabled:opacity-50`}
      >
        {pending ? "Signing out…" : label}
      </button>
    </form>
  );
}
