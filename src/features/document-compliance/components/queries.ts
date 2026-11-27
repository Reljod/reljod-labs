import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { ApiError } from "@/platform/client/api";
import type { AuditAction } from "../domain/audit";
import { api } from "./api";

/**
 * Every read the demo's screens make, as React Query options over `api`.
 * React Query passes each a signal, so a read for a view the visitor has left
 * is aborted. A page that reads on the server passes the result in as the
 * query's `initialData`; with the provider's `staleTime` it is not read again
 * on mount.
 */

export const runKey = (runId: string) => ["prescreen-run", runId];

/** One run; null when it does not exist or belongs to someone else. */
export const runQuery = (runId: string) =>
  queryOptions({
    queryKey: runKey(runId),
    queryFn: async ({ signal }) => {
      try {
        return await api.run(runId, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });

export const SESSION_RUNS_KEY = ["prescreen-session-runs"];

export const sessionRunsQuery = () =>
  queryOptions({
    queryKey: SESSION_RUNS_KEY,
    queryFn: ({ signal }) => api.runs({ signal }),
  });

export const RULES_KEY = ["document-compliance-rules"];

export const rulesQuery = () =>
  queryOptions({
    queryKey: RULES_KEY,
    queryFn: ({ signal }) => api.rules({ signal }),
  });

export const ruleVersionsKey = (ruleId: string) => [
  "document-compliance-rule-versions",
  ruleId,
];

export const ruleVersionsQuery = (ruleId: string) =>
  queryOptions({
    queryKey: ruleVersionsKey(ruleId),
    queryFn: ({ signal }) => api.ruleVersions(ruleId, { signal }),
  });

export const AUDIT_KEY = "document-compliance-audit";

/** The Audit trail, a page at a time; `before` is the cursor of the next page. */
export const auditQuery = (runId: string | null, action: AuditAction | "") =>
  infiniteQueryOptions({
    queryKey: [AUDIT_KEY, runId, action],
    queryFn: ({ pageParam, signal }) =>
      api.audit(
        { runId, action: action || null, before: pageParam },
        { signal },
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.before,
  });
