import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { DENIED_MESSAGE } from "@/features/access/constants";
import { AccessDeniedError } from "@/features/access/server/gate";
import {
  InvalidError,
  LimitError,
  NotFoundError,
  RuleEditRefused,
  RuleRefusal,
  SandboxUnavailable,
  StateError,
} from "./errors";

/** Anything an Owner saved, or that can still change. */
export const NO_STORE = "private, no-store";
/** Deterministic shared data: the Catalog, the Skills, the App document. */
export const SEED = "private, max-age=300, stale-while-revalidate=3600";

const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "cache-control": NO_STORE } });

/**
 * Turns what a Canvas route handler threw into the JSON answer the contract
 * promises (`domain/api.ts`). Never returns a stack trace or a cause.
 */
export function failure(error: unknown): Response {
  // Next's own signals (a prerender bail-out, notFound, redirect) are not failures.
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError)
    return answer(401, { error: DENIED_MESSAGE });
  if (error instanceof NotFoundError)
    return answer(404, { error: error.message });
  if (error instanceof StateError) return answer(409, { error: error.message });
  if (error instanceof LimitError) return answer(429, { error: error.message });
  if (error instanceof SandboxUnavailable)
    return answer(503, { error: error.message });
  if (error instanceof RuleEditRefused)
    return answer(400, { error: error.message, errors: error.errors });
  if (error instanceof RuleRefusal)
    return answer(400, { error: error.message, rule: error.rule });
  if (error instanceof InvalidError)
    return answer(400, { error: error.message });
  if (error instanceof ZodError)
    return answer(400, {
      error: error.issues[0]?.message ?? "That request doesn't look right.",
    });
  console.error("[canvas]", error);
  return answer(500, { error: "Something went wrong on our side." });
}

export function json<T>(
  body: T,
  init?: { status?: number; cache?: string },
): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": init?.cache ?? NO_STORE },
  });
}

/** A request body as JSON, or an empty object when there is none. */
export async function bodyOf(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}

/** The response headers of an NDJSON stream (a Question's events). */
export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": `${NO_STORE}, no-transform`,
  "x-accel-buffering": "no",
} as const;
