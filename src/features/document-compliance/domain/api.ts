import { z } from "zod";
import type {
  RuleVersionView,
  RuleView,
  RunView,
  SessionRunView,
} from "../view";
import { AUDIT_ACTION_IDS, type AuditAction, type AuditPage } from "./audit";
import type { FindingChange } from "./review";

/**
 * The demo's REST contract: every route under `/api/document-compliance/`,
 * what it takes and what it answers. Every route passes the Access gate and
 * scopes its rows to the Owner; writes come from this site only. Errors are
 * JSON `{ error }` with 400, 401, 403, 404, 409 or 429 (a Pre-screen refused
 * by a cap also carries `runId`, the latest stored run to show instead).
 */
export const API_ROOT = "/api/document-compliance";

const id = (value: string | number) => encodeURIComponent(String(value));

export const ROUTES = {
  /** GET → `RunListResponse`; POST `StartRunRequest` → `StartRunResponse` (201). */
  runs: `${API_ROOT}/runs`,
  /** GET → `RunResponse`; 404 for a run that is not the Owner's. */
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  /** GET → the live run's ScanEvents as NDJSON, from event `from` on. */
  runEvents: (runId: string) => `${API_ROOT}/runs/${id(runId)}/events`,
  /** POST (no body) → `ReevaluateResponse`: the run's next Evaluation. */
  evaluations: (runId: string) => `${API_ROOT}/runs/${id(runId)}/evaluations`,
  /** POST `ReviewRequest` → 204: a Reviewer decision on the latest Evaluation. */
  reviews: (runId: string) => `${API_ROOT}/runs/${id(runId)}/reviews`,
  /** GET → `RuleListResponse` */
  rules: `${API_ROOT}/rules`,
  /** PATCH `RuleEdit` → `RuleWriteResponse`: the Rule's next Version. */
  rule: (ruleId: string) => `${API_ROOT}/rules/${id(ruleId)}`,
  /** GET → `RuleVersionsResponse` */
  ruleVersions: (ruleId: string) => `${API_ROOT}/rules/${id(ruleId)}/versions`,
  /** POST → `RuleWriteResponse`: an earlier Version (0, the Default) back in force as the next one. */
  restoreVersion: (ruleId: string, version: number) =>
    `${API_ROOT}/rules/${id(ruleId)}/versions/${id(version)}/restore`,
  /** GET → `AuditResponse` */
  audit: `${API_ROOT}/audit`,
  /** GET → 302 to a short-lived signed URL of one preset page image. */
  packPage: (packSlug: string, file: string) =>
    `${API_ROOT}/packs/${id(packSlug)}/${id(file)}`,
};

export type RunListResponse = SessionRunView[];
export type RunResponse = RunView;
export type RuleListResponse = RuleView[];
export type RuleVersionsResponse = RuleVersionView[];
export type AuditResponse = AuditPage;
export type StartRunResponse = { runId: string };
export type ReevaluateResponse = { number: number; changes: FindingChange[] };
/** A refused Rule edit's 400 also carries `errors`, one `RuleEditError` per Parameter. */
export type RuleWriteResponse = { version: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A run id as the database stores it; anything else names no run. */
export function isRunId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export const runPathSchema = z.object({
  /** Checked by the service: a malformed id answers 404, like a missing run. */
  runId: z.string().max(64),
});

export const rulePathSchema = z.object({
  ruleId: z.string().min(1).max(64),
});

export const versionPathSchema = rulePathSchema.extend({
  version: z.coerce
    .number({ error: "No such Version." })
    .int("No such Version.")
    .min(0, "No such Version.")
    .max(1_000_000, "No such Version."),
});

export const packPagePathSchema = z.object({
  slug: z.string().min(1).max(80),
  file: z.string().min(1).max(200),
});

export const startRunSchema = z.object({
  packSlug: z.string().min(1).max(80),
});
export type StartRunRequest = z.infer<typeof startRunSchema>;

/** Shape only: what a Rule accepts is checked by the Rule itself (`applyRuleEdit`). */
export const ruleEditSchema = z.object({
  enabled: z.boolean().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Shape only: the outcome and note are checked by `checkReview`. */
export const reviewSchema = z.object({
  requirementId: z.string().min(1).max(64),
  evaluation: z
    .number({ error: "No such Evaluation." })
    .int("No such Evaluation.")
    .min(1, "No such Evaluation."),
  outcome: z.unknown(),
  note: z.unknown(),
});
export type ReviewRequest = z.infer<typeof reviewSchema>;

export const eventsQuerySchema = z.object({
  from: z.coerce.number().int().min(0).catch(0).default(0),
});

export type AuditQuery = {
  runId: string | null;
  action: AuditAction | null;
  before: number | null;
};

export const auditQuerySchema = z.object({
  runId: z.string().regex(UUID, "No such run.").nullable().default(null),
  action: z
    .enum(AUDIT_ACTION_IDS as [AuditAction, ...AuditAction[]])
    .nullable()
    .default(null),
  before: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .default(null),
});
