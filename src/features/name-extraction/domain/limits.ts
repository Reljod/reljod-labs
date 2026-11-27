/**
 * Sieve's caps on starting paid work and on writes, in one place
 * (conventions.md). They are taken in the services, so the app and the MCP
 * server hit the same ones. A Run's own caps (turns, Readers, spend) are
 * `RUN_LIMITS` in `server/toolkit/state.ts`, where the workflow reads them.
 */
export const LIMITS = {
  runsPerOwnerPerDay: 20,
  runsPerVisitorPerHour: 8,
  /** Runs one Owner may have going at once. */
  activePerOwner: 2,
  uploadsPerOwnerPerDay: 30,
  rulebooksPerOwnerPerDay: 50,
  /** The longest Document a Run takes (and an Upload holds). */
  maxPages: 500,
  /** Characters of one page of an Upload. */
  charsPerPage: 20_000,
  /** Pages one preview read returns. */
  previewPages: 12,
} as const;

/** A Run older than this that still says it is going has lost its workflow. */
export const STALE_RUN_MS = 45 * 60_000;
