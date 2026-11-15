"use client";

import { type FormEvent, useEffect, useRef } from "react";

/**
 * Stops a form that writes from being sent twice. `pending` from
 * useActionState only turns true on the next render, so a fast double click
 * can land before the button is disabled; this ref closes that gap. Pass the
 * action's state too, so the guard reopens on every result.
 */
export function useSubmitGuard(pending: boolean, state?: unknown) {
  const busy = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reopen on every new result, not only when pending flips
  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending, state]);
  return (event: FormEvent<HTMLFormElement>) => {
    if (busy.current) {
      event.preventDefault();
      return;
    }
    busy.current = true;
  };
}
