import { z } from "zod";
import { modelChoiceSchema } from "./models";
import { type RuleOverride, ruleOverrideSchema } from "./rules";
import type {
  AuditEvent,
  DeskView,
  ExportKind,
  RunView,
  StartInput,
} from "./run";

/*
 * The HTTP contract of Handover: paths, request schemas and response types.
 * Every read is a GET and every write a POST, PUT or DELETE on a resource
 * under `API_ROOT` (`src/app/api/process-transfer/`).
 */

export const API_ROOT = "/api/process-transfer";

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  /** GET: the Desk. */
  desk: () => `${API_ROOT}/desk`,
  /** POST: a one-time upload URL for a Recording. */
  uploads: () => `${API_ROOT}/uploads`,
  /** POST: start a Run. */
  runs: () => `${API_ROOT}/runs`,
  /** GET: one Run. */
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  /** GET: the Run's events as NDJSON, from `?from=<events already seen>`. */
  runEvents: (runId: string) => `${API_ROOT}/runs/${id(runId)}/events`,
  /** POST: stop the Run. */
  stop: (runId: string) => `${API_ROOT}/runs/${id(runId)}/stop`,
  /** POST: Design, Check and Approve again under the current Rules. */
  redo: (runId: string) => `${API_ROOT}/runs/${id(runId)}/redo`,
  /** POST: a download of the workflow document or the Deck, for the Audit trail. */
  exports: (runId: string) => `${API_ROOT}/runs/${id(runId)}/exports`,
  /** DELETE: every Rule back to its default. */
  rules: () => `${API_ROOT}/rules`,
  /** PUT: one Rule's override (null puts it back to default). */
  rule: (ruleId: string) => `${API_ROOT}/rules/${id(ruleId)}`,
  /** PUT: the models the pipeline calls. */
  models: () => `${API_ROOT}/models`,
  /** GET: a page of the Audit trail. */
  audit: (query: AuditQuery = {}) => `${API_ROOT}/audit${auditSearch(query)}`,
};

/** GET /desk */
export type DeskResponse = { desk: DeskView };
/** GET /runs/[runId]; 404 when this Owner has no such Run. */
export type RunResponse = { run: RunView };
/** GET /audit: one page, newest first; a page shorter than `AUDIT_PAGE` is the last. */
export type AuditListResponse = { events: AuditEvent[] };
/** POST /runs and POST /runs/[runId]/redo: the Run to open and follow. */
export type StartedResponse = { runId: string };
/** PUT /rules/[ruleId] and DELETE /rules: the Owner's Rules as now saved. */
export type RulesResponse = Pick<
  DeskView,
  "rules" | "ruleOverrides" | "rulesVersion"
>;
/** PUT /models */
export type ModelsResponse = Pick<DeskView, "models">;

/** Lines in one page of the Audit trail. */
export const AUDIT_PAGE = 100;

// Any 8-4-4-4-12 hex id, as the repository accepts (`ownedRun`).
const runIdSchema = z.guid();

/** A Run id from the address, or null when it is not one. */
export function parseRunId(value: unknown): string | null {
  const parsed = runIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const auditQuerySchema = z.object({
  before: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  runId: runIdSchema.optional(),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** The query string of a page of the Audit trail, the inverse of `auditSearchSchema`. */
export function auditSearch(query: AuditQuery): string {
  const params = new URLSearchParams();
  if (query.before !== undefined) params.set("before", String(query.before));
  if (query.runId !== undefined) params.set("run", query.runId);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** The Audit route's query string as it arrives: `?before=<line id>&run=<Run id>`, both optional. */
export const auditSearchSchema = z
  .object({
    before: auditQuerySchema.shape.before,
    run: auditQuerySchema.shape.runId,
  })
  .transform(({ before, run }): AuditQuery => ({ before, runId: run }));

/** A Run id segment: anything that is not one is simply not found. */
export const runParamsSchema = z.object({
  runId: z.string().transform((value) => parseRunId(value)),
});

/** `?from=<events already seen>` on the events route; missing or garbage reads as 0. */
export const eventsQuerySchema = z.object({
  from: z.coerce
    .number()
    .catch(0)
    .transform((value) =>
      Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0,
    ),
});

/** POST /uploads. The type, size and name are checked by `uploadProblem`, with messages a person can act on. */
export const uploadRequestSchema = z.object({
  name: z.string().max(1000),
  size: z.number(),
  type: z.string().max(200),
});

/** POST /runs */
export const startRequestSchema: z.ZodType<StartInput> = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("sample"), slug: z.string().max(200) }),
    z.object({
      kind: z.literal("upload"),
      path: z.string().max(500),
      name: z.string().max(1000),
    }),
  ],
);

/** POST /runs/[runId]/exports */
export const exportRequestSchema: z.ZodType<{ kind: ExportKind }> = z.object({
  kind: z.enum(["docx", "pptx"]),
});

/** PUT /rules/[ruleId]: the override, or null for the default. */
export const ruleRequestSchema: z.ZodType<{ override: RuleOverride | null }> =
  z.object({ override: ruleOverrideSchema.nullable() });

/** A Rule id segment (`process.step-count`). */
export const ruleParamsSchema = z.object({ ruleId: z.string().max(200) });

/** PUT /models */
export const modelsRequestSchema = modelChoiceSchema;

/** A first read the page made on the server and streams to the browser. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };
