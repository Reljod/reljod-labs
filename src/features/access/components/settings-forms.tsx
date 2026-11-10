"use client";

import { useActionState } from "react";
import { LIMITS } from "../domain/guest-pass";
import {
  changePassword,
  type SettingsState,
  updateProfile,
} from "../server/actions";
import { fieldClass, submitClass } from "./styles";

function Outcome({ state }: { state: SettingsState }) {
  if (!state) return null;
  return "error" in state ? (
    <p role="alert" className="text-sm text-seal-red">
      {state.error}
    </p>
  ) : (
    <output className="block text-sm font-semibold text-ivy">
      {state.saved}
    </output>
  );
}

/** Where a Host edits the name shown on their profile. */
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateProfile,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="profile-email" className="eyebrow">
        Email
      </label>
      <input
        id="profile-email"
        value={email}
        readOnly
        aria-describedby="profile-email-note"
        className={`${fieldClass} bg-limestone text-ink-muted`}
      />
      <p id="profile-email-note" className="text-xs text-ink-muted">
        Your email is what makes this account a Host, so it is changed in
        Supabase and the Host list, not here.
      </p>
      <label htmlFor="profile-name" className="eyebrow">
        Name
      </label>
      <input
        id="profile-name"
        name="name"
        defaultValue={name}
        maxLength={LIMITS.nameLength}
        autoComplete="name"
        placeholder="How you want to be shown"
        className={fieldClass}
      />
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save profile"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/** Where a Host changes their password. */
export function PasswordForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    changePassword,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="password-current" className="eyebrow">
        Current password
      </label>
      <input
        id="password-current"
        name="current"
        type="password"
        required
        autoComplete="current-password"
        className={fieldClass}
      />
      <label htmlFor="password-next" className="eyebrow">
        New password
      </label>
      <input
        id="password-next"
        name="next"
        type="password"
        required
        minLength={LIMITS.passwordMinLength}
        maxLength={LIMITS.passwordMaxLength}
        autoComplete="new-password"
        className={fieldClass}
      />
      <label htmlFor="password-confirm" className="eyebrow">
        New password again
      </label>
      <input
        id="password-confirm"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
        className={fieldClass}
      />
      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Changing…" : "Change password"}
      </button>
      <Outcome state={state} />
    </form>
  );
}
