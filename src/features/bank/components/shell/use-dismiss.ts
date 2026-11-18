"use client";

import { type RefObject, useEffect } from "react";

/**
 * Closes a popover on a press outside `root` or on Escape, unless `locked`
 * (a write it started is still running).
 */
export function useDismiss(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
  locked = false,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !locked) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [root, open, close, locked]);
}
