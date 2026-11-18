import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";

/** For anything an Owner saved, or that changes. */
export const NO_STORE = "private, no-store";
/** For deterministic shared seed data, the same for every Owner (still behind the gate). */
export const SEED = "private, max-age=300, stale-while-revalidate=3600";

export type CacheControl = typeof NO_STORE | typeof SEED;

/** A 4xx a route answers on purpose, with a message safe to show. */
export class RequestError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

/** JSON with the cache policy the route chose; `NO_STORE` unless it says otherwise. */
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
 * What a Casework route handler threw, as the JSON answer `domain/api.ts`
 * promises. Never a stack or a database message.
 */
export function failure(error: unknown): Response {
  // Next's own signals (a GET bailing out of prerender on cookies) pass through.
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof RequestError)
    return json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return json({ error: "That request doesn't look right." }, { status: 400 });
  console.error("[casework]", error);
  return json({ error: "Something went wrong on our side." }, { status: 500 });
}
