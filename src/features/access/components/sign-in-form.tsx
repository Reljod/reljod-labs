"use client";

import { useActionState } from "react";
import { type DoorState, signIn } from "../server/actions";
import { fieldClass, submitClass } from "./styles";

/** Where a Host signs in with their account. */
export function SignInForm() {
  const [state, action, pending] = useActionState<DoorState, FormData>(
    signIn,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
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
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state?.error ? (
        <p role="alert" className="text-sm text-seal-red">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
