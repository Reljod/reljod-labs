"use client";

import { useEffect } from "react";

/**
 * Once the door answers with a destination, load it as a fresh page. A full
 * load drops the pages Next keeps alive in the background and every in-memory
 * cache, so nothing from the previous account shows, even for a moment.
 * Returns true while the browser is on its way, so the button stays disabled.
 */
export function useLeave(state: unknown): boolean {
  const to =
    state && typeof state === "object" && "to" in state
      ? String(state.to)
      : null;
  useEffect(() => {
    if (to) window.location.assign(to);
  }, [to]);
  return to !== null;
}
