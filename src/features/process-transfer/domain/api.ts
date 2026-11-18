import { z } from "zod";
import type { AuditEvent, DeskView, RunView } from "./run";

/*
 * The HTTP contract of the page's reads: paths, queries and response types.
 * Writes stay server actions (`server/actions.ts`); reads are GET routes so
 * they never queue behind a write (Next sends actions one at a time).
 */

export const API_ROOT = "/api/process-transfer";

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  desk: () => `${API_ROOT}/desk`,
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  runEvents: (runId: string, from: number) =>
    `${API_ROOT}/runs/${id(runId)}/events?from=${from}`,
  audit: (query: AuditQuery = {}) => `${API_ROOT}/audit${auditSearch(query)}`,
};

/** GET /desk */
export type DeskResponse = { desk: DeskView };
/** GET /runs/[runId]; 404 when this Owner has no such Run. */
export type RunResponse = { run: RunView };
/** GET /audit: one page, newest first; a page shorter than `AUDIT_PAGE` is the last. */
export type AuditListResponse = { events: AuditEvent[] };

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

/** `?before=<line id>&run=<Run id>`, both optional. Throws a ZodError when malformed. */
export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  return auditQuerySchema.parse({
    before: params.get("before") ?? undefined,
    runId: params.get("run") ?? undefined,
  });
}

/** The query string of a page of the Audit trail, the inverse of `parseAuditQuery`. */
export function auditSearch(query: AuditQuery): string {
  const params = new URLSearchParams();
  if (query.before !== undefined) params.set("before", String(query.before));
  if (query.runId !== undefined) params.set("run", query.runId);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** A first read the page made on the server and streams to the browser. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };
