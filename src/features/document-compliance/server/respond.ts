import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";

/** Anything an Owner saved or that changes: kept by this browser only, asked for again every time. */
export const NO_STORE = "private, no-store";
/** Deterministic shared seed or fixture data. Never `public`: it is all behind the gate. */
export const SEED = "private, max-age=300, stale-while-revalidate=3600";

export type CacheControl = typeof NO_STORE | typeof SEED;

/** JSON with an explicit cache policy; owned data unless told otherwise. */
export function json<T>(
  body: T,
  init?: { status?: number; cache?: CacheControl },
): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": init?.cache ?? NO_STORE },
  });
}

/** A refusal the browser shows as it is. */
export class NotFoundError extends Error {}

/**
 * Turns what a route handler threw into the JSON answer `domain/api.ts`
 * promises. Never a stack or a secret: an unexpected error is logged here and
 * answered with a plain sentence.
 */
export function failure(error: unknown): Response {
  // Next's own signals (a GET handler leaving the prerender because it reads
  // headers) are not failures: let them through.
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof NotFoundError) {
    return json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ZodError) {
    return json(
      { error: error.issues[0]?.message ?? "That request doesn't look right." },
      { status: 400 },
    );
  }
  console.error("[document-compliance]", error);
  return json(
    { error: "Something went wrong on our side. Try again in a moment." },
    { status: 500 },
  );
}
