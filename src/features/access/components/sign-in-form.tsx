"use client";

import { useActionState } from "react";
import { useSubmitGuard } from "@/components/ui/use-submit-guard";
import { type DoorState, signIn } from "../server/actions";
import { fieldClass, submitClass } from "./styles";
import { useLeave } from "./use-leave";

/** Where a Host signs in with their account, then goes on to `next` if given. */
export function SignInForm({ next }: { next?: string | null }) {
  const [state, action, pending] = useActionState<DoorState, FormData>(
    signIn,
    null,
  );
  const guard = useSubmitGuard(pending, state);
  const busy = useLeave(state) || pending;
  return (
    <form action={action} onSubmit={guard} className="flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <label htmlFor="host-email" className="eyebrow">
        Email
      </label>
      <input
        id="host-email"
        name="email"
        type="email"
        required
        autoComplete="username"
        className={fieldClass}
      />
      <label htmlFor="host-password" className="eyebrow">
        Password
      </label>
      <input
        id="host-password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        className={fieldClass}
      />
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className={submitClass}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {state && "error" in state ? (
        <p role="alert" className="text-sm text-seal-red">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
