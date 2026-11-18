"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { api } from "../api";
import { useHarness } from "../harness-context";
import type { Host } from "./engine";

/**
 * The `Host` a Beat sees, built from the Harness shell and the Harness API.
 * What it reads (who is signed in) is always the latest, however long ago the
 * engine was made.
 */
export function useHost(): Host {
  const harness = useHarness();
  const queryClient = useQueryClient();
  const latest = useRef(harness);
  useEffect(() => {
    latest.current = harness;
  }, [harness]);
  latest.current = harness;

  return useMemo<Host>(
    () => ({
      staff: () => latest.current.staff,
      controller: (name) => latest.current.controller(name),
      runs: {
        list: (sessionId) => api.runs.list({ sessionId }),
        get: (id) => api.runs.get(id),
        start: async (request) => {
          const run = await api.runs.start(request);
          void queryClient.invalidateQueries({ queryKey: ["harness", "runs"] });
          return run;
        },
        stop: async (id) => {
          const run = await api.runs.stop(id);
          void queryClient.invalidateQueries({ queryKey: ["harness", "runs"] });
          void queryClient.invalidateQueries({ queryKey: ["harness", "run"] });
          return run;
        },
      },
      sources: { list: () => api.sources.list() },
      rules: {
        restore: async (ruleId) => {
          await api.rules.restore(ruleId);
          for (const key of [
            "rules",
            "rule-history",
            "skills",
            "skill",
          ] as const) {
            void queryClient.invalidateQueries({ queryKey: ["harness", key] });
          }
        },
      },
      today: () => new Date().toISOString().slice(0, 10),
    }),
    [queryClient],
  );
}
