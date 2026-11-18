import type {
  ExaminationDetail,
  ExaminationSummary,
  ManifestEntry,
  StoredEvent,
  UploadSummary,
} from "./contract";
import type { RulebookVersion } from "./rules";
import type { RecordedSweep } from "./score";

/**
 * Loupe's read routes under `/api/loupe/`: where each lives and what it
 * answers. Reads are GET routes, not server actions (conventions.md: "A demo
 * reads through GET routes"). Writes stay server actions (server/actions.ts).
 * The browser calls these only through `components/api.ts`.
 *
 * Every route passes the Access gate and scopes what it reads to the Owner.
 * Errors are JSON `{ error: string }` with 400, 401 (plain text from the
 * gate), 404 or 500.
 */
export const API_ROOT = "/api/loupe";
export const MCP_PATH = `${API_ROOT}/mcp`;

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  examinations: () => `${API_ROOT}/examinations`,
  examination: (examinationId: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}`,
  /** NDJSON, one `StoredEvent` per line; reconnect with the last seq. */
  events: (examinationId: string, after: number) =>
    `${API_ROOT}/examinations/${id(examinationId)}/events?after=${after}`,
  /** A page image or an Evidence layer of one of the Owner's Examinations. */
  asset: (examinationId: string, key: string) =>
    `${API_ROOT}/examinations/${id(examinationId)}/asset?key=${id(key)}`,
  rulebooks: () => `${API_ROOT}/rulebooks`,
  corpus: () => `${API_ROOT}/corpus`,
  uploads: () => `${API_ROOT}/uploads`,
  audit: () => `${API_ROOT}/audit`,
};

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
