"use client";

import type { Destination } from "../domain/api";
import { redeemGuestCode } from "./api";
import { fieldClass, submitClass } from "./styles";
import { useLeave } from "./use-leave";
import { useWrite } from "./use-write";

/** Where a Guest types the code their Host gave them. */
export function CodeForm({ next }: { next: string }) {
  const { run, pending, outcome } = useWrite<Destination>();
  const busy = useLeave(outcome?.ok ? outcome.value : null) || pending;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(() =>
          redeemGuestCode({ code: String(form.get("code") ?? ""), next }),
        );
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor="guest-code" className="eyebrow">
        Guest code
      </label>
      <input
        id="guest-code"
        name="code"
        data-testid="guest-code"
        required
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={24}
        placeholder="XXXX-XXXX-XXXX"
        className={`${fieldClass} font-mono text-lg tracking-[0.15em] uppercase`}
      />
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className={submitClass}
      >
        {busy ? "Checking…" : "Open the demos"}
      </button>
      {outcome && !outcome.ok ? (
        <p role="alert" className="text-sm text-seal-red">
          {outcome.error}
        </p>
      ) : null}
    </form>
  );
}
