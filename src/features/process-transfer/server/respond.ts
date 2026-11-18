import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";

/*
 * How the page's GET routes answer (`domain/api.ts`). Wrap every handler body
 * in try/catch and return `failure(error)` from the catch.
 */

/** For anything an Owner saved or that changes. */
export const NO_STORE = "private, no-store";
/** For deterministic shared seed or fixture data. Never `public`: it is all behind the gate. */
export const SEED = "private, max-age=300, stale-while-revalidate=3600";

export type CacheControl = typeof NO_STORE | typeof SEED;

export function json<T>(
  body: T,
  init?: { status?: number; cache?: CacheControl },
): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": init?.cache ?? NO_STORE },
  });
}

/** A `{ error }` answer the page can show as it is. */
export function refusal(status: number, error: string): Response {
  return json({ error }, { status });
}

/** Turns what a handler threw into its answer; never a stack or a secret. */
export function failure(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof ZodError) {
    return refusal(400, "That request doesn't look right.");
  }
  console.error("[process-transfer]", error);
  return refusal(500, "Something went wrong. Try again.");
}
