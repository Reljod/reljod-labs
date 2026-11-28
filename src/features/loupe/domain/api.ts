import { z } from "zod";
import {
  boxSchema,
  checkIdSchema,
  DOCUMENT_KINDS,
  DRIVERS,
  type Driver,
  type ExaminationDetail,
  type ExaminationStatus,
  type ExaminationSummary,
  editSchema,
  type ManifestEntry,
  modelIdSchema,
  type StoredEvent,
  type UploadSummary,
  type Verdict,
} from "./contract";
import { LIMITS } from "./limits";
import type { RulebookVersion } from "./rules";
import type { RecordedSweep } from "./score";

/**
 * Loupe's REST routes under `/api/loupe/`: where each lives, what it takes
 * and what it answers. The browser calls these only through
 * `components/api.ts`; an outside client reaches the same services through
 * the MCP server (`MCP_PATH`).
 *
 * Every route passes the Access gate and scopes what it reads or writes to
 * the Owner. Errors are JSON `{ error: string }` with 400, 401 (plain text
 * from the proxy), 404, 409, 429 or 500.
 */
export const API_ROOT = "/api/loupe";
export const MCP_PATH = `${API_ROOT}/mcp`;

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  /** GET the Owner's Examinations; POST starts one. */
  examinations: () => `${API_ROOT}/examinations`,
  examination: (examinationId: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}`,
  /** NDJSON, one `StoredEvent` per line; reconnect with the last seq. */
  events: (examinationId: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}/events`,
  /** A page image or an Evidence layer of one of the Owner's Examinations. */
  asset: (examinationId: string, key: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}/asset?key=${id(key)}`,
  /** POST: the escape hatch. */
  stop: (examinationId: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}/stop`,
  /** POST: decide it again under the current Rulebook. */
  reevaluate: (examinationId: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}/reevaluate`,
  /** POST: run one named Check again on a page or a region. */
  checks: (examinationId: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}/checks`,
  /** GET every version; POST saves the next one. */
  rulebooks: () => `${API_ROOT}/rulebooks`,
  corpus: () => `${API_ROOT}/corpus`,
  /** GET the Owner's Uploads; POST opens one. */
  uploads: () => `${API_ROOT}/uploads`,
  audit: () => `${API_ROOT}/audit`,
  /** POST mints an Owner's MCP token. */
  tokens: () => `${API_ROOT}/tokens`,
};

// Reads ------------------------------------------------------------------------------

/** GET examinations: the Owner's Examinations, newest first. */
export type ExaminationListResponse = ExaminationSummary[];
/** GET examinations/[id]: the Examination with its Trail, Measurements and Findings. */
export type ExaminationResponse = ExaminationDetail;
/** One line of GET examinations/[id]/events. */
export type EventLine = StoredEvent;
/** GET rulebooks: every version, newest first, then the Defaults (version 0); the first is current. */
export type RulebookListResponse = RulebookVersion[];
/**
 * GET corpus: the Manifest and the recorded Sweep of every Corpus Document,
 * so the page can show Calibration under a Rulebook the visitor is still
 * editing without asking the server (`calibrate` is pure). Seed data.
 */
export type CorpusResponse = {
  entries: ManifestEntry[];
  sweeps: RecordedSweep[];
};
/** GET uploads: the Owner's Uploads and Forgeries, newest first. */
export type UploadListResponse = UploadSummary[];

/** One row of the Owner's Audit trail (writes outside an Examination's own Trail). */
export type AuditEvent = {
  id: number;
  at: string;
  action: AuditAction;
  /** Who did it: the Owner in the app, or a client on the Owner's MCP token. */
  via: "app" | "mcp";
  /** Ids, names and sizes; never a file or a token. */
  detail: Record<string, string | number | boolean | null>;
};
/** GET audit: the newest 200 events. */
export type AuditResponse = AuditEvent[];

export const AUDIT_ACTIONS = {
  "examination.started": "Examination started",
  "examination.stopped": "Examination stopped",
  "examination.reevaluated": "Examination re-evaluated",
  "check.run": "Check run",
  "rulebook.saved": "Rulebook saved",
  "upload.created": "Upload opened",
  "forgery.created": "Forgery submitted",
  "token.minted": "MCP token minted",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** GET examinations/[id]/events?after=<seq>. */
export const eventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).catch(0).default(0),
});

// Writes -----------------------------------------------------------------------------

export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sample"), sampleId: z.string().min(1).max(60) }),
  z.object({ kind: z.literal("upload"), uploadId: z.string().uuid() }),
]);

/** POST examinations: a Sample or one of the Owner's Uploads. */
export const startRequestSchema = z.object({
  source: sourceSchema,
  driver: z
    .enum(Object.keys(DRIVERS) as [Driver, ...Driver[]])
    .optional()
    .catch(undefined),
  model: modelIdSchema.optional().catch(undefined),
});
export type StartRequest = z.infer<typeof startRequestSchema>;
export type StartResponse = { examinationId: string };

/** POST examinations/[id]/stop. */
export type StopResponse = {
  examinationId: string;
  stopped: boolean;
  status: ExaminationStatus;
};

/** POST examinations/[id]/reevaluate: the Verdict before and after. */
export type ReevaluateResponse = {
  examinationId: string;
  fromVersion: number;
  toVersion: number;
  from: Verdict;
  to: Verdict;
  findings: number;
};

/** POST examinations/[id]/checks: the same Check, cap and Trail as the MCP tool `run_check`. */
export const checkRequestSchema = z.object({
  check: checkIdSchema,
  page: z.number().int().min(1).max(200).optional(),
  box: boxSchema.nullable().optional(),
});
export type CheckRequest = z.infer<typeof checkRequestSchema>;
export type CheckResponse = { text: string };

/** POST rulebooks: the whole Rulebook, checked against each Rule's bounds on the server. */
export const saveRulebookSchema = z.object({
  rulebook: z.unknown(),
  note: z.string().max(2000).optional(),
});
export type SaveRulebookResponse = { version: number; changes: string[] };

/** POST uploads: what the file is; the bytes go to the signed URL. */
export const uploadRequestSchema = z.object({
  title: z.string().max(400),
  contentType: z.string().max(60),
  bytes: z.number().int().min(1),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  forgery: z
    .object({
      sampleId: z.string().max(60),
      edits: z.array(editSchema).min(1).max(LIMITS.editsPerForgery),
    })
    .optional(),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
export type UploadResponse = {
  uploadId: string;
  signedUrl: string;
  token: string;
  path: string;
};

/** POST tokens: shown once, never stored. */
export type TokenResponse = { token: string; expiresAt: string };
