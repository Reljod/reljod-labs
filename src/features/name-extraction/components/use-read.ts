"use client";

import { useEffect, useState } from "react";
import { reads } from "./read-cache";
import { friendly } from "./ui";

type State<T> = { path: string | null; data?: T; error?: string };

/**
 * A read route's answer through the page's read cache: on the first paint
 * when it is already in hand (prefetched or seen before), else once it lands.
 * Null `path` reads nothing.
 */
export function useCachedRead<T>(
  path: string | null,
  maxAgeMs: number,
  fallback: string,
): { data?: T; error?: string } {
  const [state, setState] = useState<State<T>>(() => ({
    path,
    data: path ? reads.peek<T>(path, maxAgeMs) : undefined,
  }));
  useEffect(() => {
    if (!path) return;
    const ready = reads.peek<T>(path, maxAgeMs);
    if (ready !== undefined) {
      setState((current) =>
        current.path === path && current.data === ready
          ? current
          : { path, data: ready },
      );
      return;
    }
    let live = true;
    setState({ path });
    reads.get<T>(path, maxAgeMs).then(
      (data) => {
        if (live) setState({ path, data });
      },
      (caught: unknown) => {
        if (live) setState({ path, error: friendly(caught, fallback) });
      },
    );
    return () => {
      live = false;
    };
  }, [path, maxAgeMs, fallback]);
  return state.path === path ? state : {};
}
