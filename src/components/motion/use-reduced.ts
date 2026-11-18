"use client";

import { useEffect, useState } from "react";

/**
 * Whether the visitor asked for reduced motion. False on the server and on
 * the first client render, so hydration always matches; the real setting
 * arrives right after mount. (motion's `useReducedMotion` answers on the
 * first client render, which differs from the server's HTML.)
 */
export function useReduced(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduce;
}
