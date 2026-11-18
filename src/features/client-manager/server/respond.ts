import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";
import { LimitError } from "./service";

/** Anything an Owner saved or that changes: never kept by the browser. */
export const NO_STORE = "private, no-store";

/** Shared seed data (Sample clients, read-only): the browser may keep it a while. */
export const SEED = "private, max-age=300, stale-while-revalidate=3600";

export type CacheControl = typeof NO_STORE | typeof SEED;

/** A JSON answer; `no-store` unless the caller says the body is seed data. */
export function json<T>(
  body: T,
  init?: { status?: number; cache?: CacheControl },
): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": init?.cache ?? NO_STORE },
  });
}

const answer = (status: number, error: string) => json({ error }, { status });

/** Turns what a handler threw into a JSON answer the browser can show. */
export function failure(error: unknown): Response {
  // Next's own signals (a prerender bail-out) are not failures.
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof LimitError) return answer(429, error.message);
  if (error instanceof ZodError) {
    return answer(
      400,
      error.issues[0]?.message ?? "That request doesn't look right.",
    );
  }
  console.error("client-manager", error);
  return answer(500, "Something went wrong on our side.");
}

export const notFound = () => answer(404, "Not found");
