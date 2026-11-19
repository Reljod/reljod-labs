/**
 * Loupe's caps, in one place (conventions.md: "Cap paid work at every entry
 * point"). The server functions apply them, for the app and the MCP server
 * alike; the harness, never the Examiner, owns the per-Examination ones.
 */
export const LIMITS = {
  examinationsPerOwnerPerDay: 30,
  examinationsPerVisitorPerHour: 10,
  /** Examinations one Owner may have going at once. */
  activePerOwner: 2,
  uploadsPerOwnerPerDay: 40,
  rulebooksPerOwnerPerDay: 60,
  /** A Check run outside the Examiner's own loop (the page, an MCP client), per visitor. */
  checksPerVisitorPerHour: 30,
  /** Re-evaluates per Owner: no model, but each rewrites the Examination. */
  reevaluatesPerOwnerPerHour: 120,
  mcpTokensPerOwnerPerDay: 20,
  /** An Upload's size. */
  uploadBytes: 12 * 1024 * 1024,
  /** Pages of a Document; the Toolkit refuses more. */
  maxPages: 10,
  /** Edits on one Forgery. */
  editsPerForgery: 12,
  titleChars: 120,
} as const;

/** What one Examination may spend. The workflow checks them before every turn and tool call. */
export const RUN_LIMITS = {
  /** Examiner model calls. */
  turns: 22,
  /** `run_code` calls. */
  codeRuns: 10,
  /** `run_check` calls. */
  checkRuns: 14,
  /** `look` calls. */
  looks: 24,
  hypotheses: 10,
  /** USD, at what the gateway says each call is worth. */
  costUsd: 0.75,
  outputTokens: 3_000,
  /** Characters of one piece of code. */
  codeChars: 12_000,
  /** Images kept in the Examiner's context; older looks become a line of text. */
  imagesInContext: 3,
} as const;

/** An Examination older than this that still says it is going has lost its workflow. */
export const STALE_EXAMINATION_MS = 30 * 60_000;

export const UPLOAD_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type UploadType = keyof typeof UPLOAD_TYPES;

export function isUploadType(value: unknown): value is UploadType {
  return typeof value === "string" && value in UPLOAD_TYPES;
}
