"use client";

import type { Destination } from "../domain/api";
import { signIn } from "./api";
import { fieldClass, submitClass } from "./styles";
import { useLeave } from "./use-leave";
import { useWrite } from "./use-write";

/** Where a Host signs in with their account, then goes on to `next` if given. */
export function SignInForm({ next }: { next?: string | null }) {
  const { run, pending, outcome } = useWrite<Destination>();
  const busy = useLeave(outcome?.ok ? outcome.value : null) || pending;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(() =>
          signIn({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
            next: next ?? null,
          }),
        );
      }}
      className="flex flex-col gap-3"
    >
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
      {outcome && !outcome.ok ? (
        <p role="alert" className="text-sm text-seal-red">
          {outcome.error}
        </p>
      ) : null}
    </form>
  );
}
