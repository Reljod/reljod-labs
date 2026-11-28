"use client";

import { useRouter } from "next/navigation";
import type { Outcome as WriteOutcome } from "@/platform/client/api";
import type { Saved } from "../domain/api";
import { LIMITS } from "../domain/guest-pass";
import { changePassword, saveProfile } from "./api";
import { fieldClass, submitClass } from "./styles";
import { useWrite } from "./use-write";

function Outcome({ outcome }: { outcome: WriteOutcome<Saved> | null }) {
  if (!outcome) return null;
  return outcome.ok ? (
    <output className="block text-sm font-semibold text-ivy">
      {outcome.value.saved}
    </output>
  ) : (
    <p role="alert" className="text-sm text-seal-red">
      {outcome.error}
    </p>
  );
}

/** Where a Host edits the name shown on their profile. */
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const { run, pending, outcome } = useWrite<Saved>();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const result = await run(() =>
          saveProfile(String(form.get("name") ?? "")),
        );
        // The page shows the name too: read it again.
        if (result?.ok) router.refresh();
      }}
      className="flex flex-col gap-3"
    >
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
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={submitClass}
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
      <Outcome outcome={outcome} />
    </form>
  );
}

/** Where a Host changes their password. */
export function PasswordForm() {
  const { run, pending, outcome } = useWrite<Saved>();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        const result = await run(() =>
          changePassword({
            current: String(form.get("current") ?? ""),
            next: String(form.get("next") ?? ""),
            confirm: String(form.get("confirm") ?? ""),
          }),
        );
        // No password stays on screen once it is changed.
        if (result?.ok) element.reset();
      }}
      className="flex flex-col gap-3"
    >
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
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={submitClass}
      >
        {pending ? "Changing…" : "Change password"}
      </button>
      <Outcome outcome={outcome} />
    </form>
  );
}
