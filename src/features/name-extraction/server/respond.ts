import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";

/** For anything an Owner saved or that changes. */
export const NO_STORE = "private, no-store";
/** For deterministic shared seed data (behind the gate, so never `public`). */
export const SEED = "private, max-age=300, stale-while-revalidate=3600";
export type CacheControl = typeof NO_STORE | typeof SEED;

/** A JSON answer; owned data unless told otherwise. */
export function json<T>(
  body: T,
  init?: { status?: number; cache?: CacheControl },
): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": init?.cache ?? NO_STORE },
  });
}

/**
 * Turns what a Sieve route handler threw into its JSON answer. Wrap every
 * handler body in try/catch and return this from the catch. Never a stack
 * or a server message: those stay in the log.
 */
export function failure(error: unknown): Response {
  // Next's own signals (bailing out of a prerender on cookies) pass through.
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof ZodError)
    return json(
      { error: error.issues[0]?.message ?? "That request doesn't look right." },
      { status: 400 },
    );
  console.error("[name-extraction]", error);
  return json({ error: "Something went wrong on our side." }, { status: 500 });
}

/** 404 with the contract's `{ error }`. */
export const notFound = () => json({ error: "Not found." }, { status: 404 });

/**
 * A preview read's answer: its `{ error }` refusal (the preview functions
 * return `T | { error }`, as the actions did) as 400, anything else 200.
 */
export function refusalOr(result: object): Response {
  return "error" in result ? json(result, { status: 400 }) : json(result);
}
