import { z } from "zod";
import {
  type Comparison,
  type DocumentOverview,
  type DocumentSource,
  modelChoiceSchema,
  type PreviewPage,
  type RulebookVersion,
  type RunDetail,
  type RunSummary,
} from "./contract";

/**
 * Sieve's REST routes under `/api/name-extraction/`: where each lives, what
 * it takes and what it answers. Reads are GETs; writes are POSTs that answer
 * with what they wrote. The browser calls them only through
 * `components/api.ts`.
 *
 * Every route but the MCP server passes the Access gate and scopes what it
 * reads and writes to the Owner. Errors are JSON `{ error }` with 400 (a bad
 * request), 401 (no Access), 403 (a write from another site), 404 (not
 * there, or not the Owner's), 409 (a Run that could not start) or 429 (a
 * cap).
 */
export const API_ROOT = "/api/name-extraction";

const id = (value: string) => encodeURIComponent(value);

/** The Document a preview is of: a Run brings its own, so with one the source is left out. */
function previewQuery(
  source: DocumentSource | null,
  runId: string | null | undefined,
  range?: { from: number; to: number },
) {
  const params = new URLSearchParams();
  // The server ignores the source of a Run's preview; leaving it out gives
  // every view of the Run one path (and one cache key).
  if (runId) params.set("run", runId);
  else if (source?.kind === "corpus") params.set("corpus", source.corpusId);
  else if (source?.kind === "upload") params.set("upload", source.uploadId);
  if (range) {
    params.set("from", String(range.from));
    params.set("to", String(range.to));
  }
  return params.toString();
}

/** Where each route lives. */
export const apiPath = {
  /** GET the Owner's Runs; POST starts one. */
  runs: () => `${API_ROOT}/runs`,
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  stop: (runId: string) => `${API_ROOT}/runs/${id(runId)}/stop`,
  runEvents: (runId: string) => `${API_ROOT}/runs/${id(runId)}/events`,
  comparison: (runId: string) => `${API_ROOT}/runs/${id(runId)}/comparison`,
  /** GET every version; POST saves the next one. */
  rulebooks: () => `${API_ROOT}/rulebooks`,
  uploads: () => `${API_ROOT}/uploads`,
  tokens: () => `${API_ROOT}/tokens`,
  mcp: () => `${API_ROOT}/mcp`,
  overview: (source: DocumentSource | null, runId?: string | null) =>
    `${API_ROOT}/preview/overview?${previewQuery(source, runId)}`,
  pages: (
    source: DocumentSource | null,
    runId: string | null | undefined,
    from: number,
    to: number,
  ) => `${API_ROOT}/preview/pages?${previewQuery(source, runId, { from, to })}`,
};

// Requests ---------------------------------------------------------------------------

export const documentSourceSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("corpus"),
      corpusId: z.string().min(1).max(40),
    }),
    z.object({ kind: z.literal("upload"), uploadId: z.string().uuid() }),
  ],
  { error: "Pick a Corpus Document or an upload." },
);

/** POST runs. */
export const startRunSchema = z.object({
  source: documentSourceSchema,
  models: modelChoiceSchema.optional(),
});
export type StartRunRequest = z.infer<typeof startRunSchema>;

/**
 * POST rulebooks. The Rulebook is checked in the service, which names the
 * fields that are wrong.
 */
export const saveRulebookSchema = z.object({
  rulebook: z.unknown(),
  note: z.string().max(2000).optional(),
});
export type SaveRulebookRequest = { rulebook: unknown; note?: string };

/** POST uploads: the title and page count; the pages go to Storage by signed URL. */
export const createUploadSchema = z.object({
  title: z.string().max(1000),
  pages: z.number().int(),
});
export type CreateUploadRequest = z.infer<typeof createUploadSchema>;

/** `[runId]`: the shape is checked by the service, so a bad id is a plain 404. */
export const runPathSchema = z.object({ runId: z.string().min(1).max(100) });

/** GET runs/[runId]/events?after=<seq>. */
export const eventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).catch(0).default(0),
});

/** `?corpus=|upload=` and an optional `run=`: a Run brings its own Document. */
export const overviewQuerySchema = z
  .object({
    corpus: z.string().min(1).max(40).optional(),
    upload: z.string().uuid().optional(),
    run: z.string().min(1).max(100, "No such Run.").optional(),
  })
  .transform(
    ({ corpus, upload, run }): PreviewQuery => ({
      source:
        corpus !== undefined && upload === undefined
          ? { kind: "corpus", corpusId: corpus }
          : upload !== undefined && corpus === undefined
            ? { kind: "upload", uploadId: upload }
            : null,
      ...(run ? { runId: run } : {}),
    }),
  );
/** The Document a preview asks for (null when the query names none), or the Run that brings its own. */
export type PreviewQuery = { source: DocumentSource | null; runId?: string };

const pageNumber = z.coerce
  .number({ error: "Ask for pages from 1 up, in order." })
  .int("Ask for pages from 1 up, in order.")
  .min(1, "Ask for pages from 1 up, in order.")
  .max(100_000);

/** The overview's query plus `&from=&to=` (1-based, inclusive). */
export const pagesQuerySchema = z
  .object({
    corpus: z.string().min(1).max(40).optional(),
    upload: z.string().uuid().optional(),
    run: z.string().min(1).max(100, "No such Run.").optional(),
    from: pageNumber,
    to: pageNumber,
  })
  .transform(({ from, to, ...rest }) => ({
    ...overviewQuerySchema.parse(rest),
    from,
    to,
  }));

// Responses --------------------------------------------------------------------------

/** GET runs: the Owner's Runs, newest first. */
export type RunListResponse = RunSummary[];
/** POST runs: the Run that started. */
export type StartRunResponse = { runId: string };
/** GET runs/[runId]: the Run with its Audit trail and Register. */
export type RunResponse = RunDetail;
/** POST runs/[runId]/stop: whether this call stopped it, and how it stands. */
export type StopRunResponse = {
  runId: string;
  stopped: boolean;
  status: RunSummary["status"];
};
/** GET runs/[runId]/comparison: the Run against the answer key. */
export type ComparisonResponse = Comparison;
/** GET rulebooks: every version, newest first, then the default; the first is the current one. */
export type RulebookListResponse = RulebookVersion[];
/** POST rulebooks: the version just saved. */
export type SaveRulebookResponse = RulebookVersion;
/** POST uploads: the Upload's id and the signed URL the browser PUTs `{ pages }` to. */
export type CreateUploadResponse = {
  uploadId: string;
  signedUrl: string;
  token: string;
  path: string;
};
/** POST tokens: a bearer for an outside MCP client, shown once. */
export type TokenResponse = { token: string; expiresAt: string };
/** GET preview/overview?corpus=|upload=|run=: names per page and every name. */
export type OverviewResponse = DocumentOverview;
/** GET preview/pages?…&from=&to=: at most `LIMITS.previewPages` (domain/limits.ts) pages with their marks. */
export type PagesResponse = { total: number; pages: PreviewPage[] };
