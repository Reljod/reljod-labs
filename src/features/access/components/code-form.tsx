"use client";

import { useActionState } from "react";
import { useSubmitGuard } from "@/components/ui/use-submit-guard";
import { type DoorState, redeemGuestCode } from "../server/actions";
import { fieldClass, submitClass } from "./styles";
import { useLeave } from "./use-leave";

/** Where a Guest types the code their Host gave them. */
export function CodeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<DoorState, FormData>(
    redeemGuestCode,
    null,
  );
  const guard = useSubmitGuard(pending, state);
  const busy = useLeave(state) || pending;
  return (
    <form action={action} onSubmit={guard} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
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
      {state && "error" in state ? (
        <p role="alert" className="text-sm text-seal-red">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
