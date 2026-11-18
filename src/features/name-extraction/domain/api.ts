import type {
  Comparison,
  DocumentOverview,
  DocumentSource,
  PreviewPage,
  RulebookVersion,
  RunDetail,
  RunSummary,
} from "./contract";

/**
 * Sieve's read routes under `/api/name-extraction/`: where each lives and
 * what it answers. Reads are GET routes, not server actions: Next sends a
 * client's actions one at a time, so a read made as an action waits behind
 * every other read and write. Writes stay server actions (server/actions.ts).
 * The browser calls these only through `components/api.ts`.
 *
 * Every route passes the Access gate and scopes what it reads to the Owner.
 * Errors are JSON `{ error: string }` with 400 (bad request or a refusal),
 * 401 (no Access), 404 or 500.
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
  runs: () => `${API_ROOT}/runs`,
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  runEvents: (runId: string, after: number) =>
    `${API_ROOT}/runs/${id(runId)}/events?after=${after}`,
  comparison: (runId: string) => `${API_ROOT}/runs/${id(runId)}/comparison`,
  rulebooks: () => `${API_ROOT}/rulebooks`,
  overview: (source: DocumentSource | null, runId?: string | null) =>
    `${API_ROOT}/preview/overview?${previewQuery(source, runId)}`,
  pages: (
    source: DocumentSource | null,
    runId: string | null | undefined,
    from: number,
    to: number,
  ) => `${API_ROOT}/preview/pages?${previewQuery(source, runId, { from, to })}`,
};

/** GET runs: the Owner's Runs, newest first. */
export type RunListResponse = RunSummary[];
/** GET runs/[runId]: the Run with its Audit trail and Register. */
export type RunResponse = RunDetail;
/** GET runs/[runId]/comparison: the Run against the answer key. */
export type ComparisonResponse = Comparison;
/** GET rulebooks: every version, newest first, then the default; the first is the current one. */
export type RulebookListResponse = RulebookVersion[];
/** GET preview/overview?corpus=|upload=|run=: names per page and every name. */
export type OverviewResponse = DocumentOverview;
/** GET preview/pages?…&from=&to=: at most 12 pages with their marks. */
export type PagesResponse = { total: number; pages: PreviewPage[] };
