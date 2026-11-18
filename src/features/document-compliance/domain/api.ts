import { z } from "zod";
import type {
  RuleVersionView,
  RuleView,
  RunView,
  SessionRunView,
} from "../view";
import { AUDIT_ACTION_IDS, type AuditAction, type AuditPage } from "./audit";

/**
 * The demo's read contract: every GET route under `/api/document-compliance/`
 * and what it answers. Reads are Route Handlers, not Server Actions, because
 * the client sends Server Actions one at a time and a read queued behind a
 * write (or a poll) makes every click wait. Writes stay Server Actions.
 *
 * Every route passes the Access gate and scopes its rows to the Owner. Errors
 * are JSON `{ error: string }` with 400 (bad request), 401 (no Access) or 404.
 */
export const API_ROOT = "/api/document-compliance";

const id = (value: string) => encodeURIComponent(value);

function query(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const apiPath = {
  /** GET → `RunListResponse` */
  runs: () => `${API_ROOT}/runs`,
  /** GET → `RunResponse`; 404 for a run that is not the Owner's. */
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  /** GET → `RuleListResponse` */
  rules: () => `${API_ROOT}/rules`,
  /** GET → `RuleVersionsResponse` */
  ruleVersions: (ruleId: string) => `${API_ROOT}/rules/${id(ruleId)}/versions`,
  /** GET → `AuditResponse` */
  audit: (filter: AuditQuery) =>
    `${API_ROOT}/audit${query({
      runId: filter.runId,
      action: filter.action,
      before: filter.before,
    })}`,
};

export type RunListResponse = SessionRunView[];
export type RunResponse = RunView;
export type RuleListResponse = RuleView[];
export type RuleVersionsResponse = RuleVersionView[];
export type AuditResponse = AuditPage;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A run id as the database stores it; anything else names no run. */
export function isRunId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export type AuditQuery = {
  runId: string | null;
  action: AuditAction | null;
  before: number | null;
};

export const auditQuerySchema = z.object({
  runId: z.string().regex(UUID, "No such run.").nullable(),
  action: z
    .enum(AUDIT_ACTION_IDS as [AuditAction, ...AuditAction[]])
    .nullable(),
  before: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
});

/** The Audit trail's query string, parsed; throws a ZodError when malformed. */
export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  return auditQuerySchema.parse({
    runId: params.get("runId"),
    action: params.get("action"),
    before: params.get("before"),
  });
}
