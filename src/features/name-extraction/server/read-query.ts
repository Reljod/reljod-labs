/**
 * The query strings of Sieve's read routes, checked at the boundary. Pure,
 * so the shapes the browser may send are tested without a server.
 */
import { z } from "zod";
import type { DocumentSource } from "../domain/contract";

const sourceQuery = z.union([
  z.object({ corpus: z.string().min(1).max(40), upload: z.undefined() }),
  z.object({ upload: z.string().uuid(), corpus: z.undefined() }),
]);

/** A Run id from the query: absent, or a string the repository checks the shape of. */
const runQuery = z.string().min(1).max(100).optional();

const pageNumber = z.coerce.number().int().min(1).max(100_000);

function value(params: URLSearchParams, name: string) {
  return params.get(name) ?? undefined;
}

/** The Document a preview asks for, or null (a Run brings its own). */
export function sourceOf(params: URLSearchParams): DocumentSource | null {
  const parsed = sourceQuery.safeParse({
    corpus: value(params, "corpus"),
    upload: value(params, "upload"),
  });
  if (!parsed.success) return null;
  return parsed.data.corpus !== undefined
    ? { kind: "corpus", corpusId: parsed.data.corpus }
    : { kind: "upload", uploadId: parsed.data.upload as string };
}

export type OverviewQuery = { source: DocumentSource | null; runId?: string };
export type PagesQuery = OverviewQuery & { from: number; to: number };

/** `?corpus=|upload=` and an optional `run=`. */
export function overviewQuery(
  params: URLSearchParams,
): OverviewQuery | { error: string } {
  const run = runQuery.safeParse(value(params, "run"));
  if (!run.success) return { error: "No such Run." };
  return {
    source: sourceOf(params),
    ...(run.data ? { runId: run.data } : {}),
  };
}

/** An overview query plus `from` and `to` (1-based, inclusive). */
export function pagesQuery(
  params: URLSearchParams,
): PagesQuery | { error: string } {
  const base = overviewQuery(params);
  if ("error" in base) return base;
  const from = pageNumber.safeParse(value(params, "from"));
  const to = pageNumber.safeParse(value(params, "to"));
  if (!from.success || !to.success)
    return { error: "Ask for pages from 1 up, in order." };
  return { ...base, from: from.data, to: to.data };
}
