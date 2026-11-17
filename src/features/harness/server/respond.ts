import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { DENIED_MESSAGE } from "@/features/access/constants";
import { AccessDeniedError } from "@/features/access/server/gate";
import {
  ForbiddenError,
  InvalidError,
  LimitError,
  NotBuiltError,
  NotFoundError,
  RuleRefusedError,
  StateError,
} from "./errors";

const answer = (status: number, error: string) =>
  Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );

/**
 * Turns what a Harness route handler threw into the JSON answer the contract
 * promises (`domain/api.ts`). Wrap every handler body in try/catch and return
 * this from the catch, so every route fails the same way.
 */
export function failure(error: unknown): Response {
  // Next's own signals (a GET handler bailing out of the build's prerender
  // when it reads cookies or headers) are not failures: let them through.
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return answer(401, DENIED_MESSAGE);
  if (error instanceof ForbiddenError) return answer(403, error.message);
  if (error instanceof NotFoundError) return answer(404, error.message);
  if (error instanceof StateError) return answer(409, error.message);
  if (error instanceof LimitError) return answer(429, error.message);
  if (error instanceof RuleRefusedError) {
    return Response.json(
      { error: error.message, errors: error.errors },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (error instanceof InvalidError) return answer(400, error.message);
  if (error instanceof NotBuiltError) return answer(501, error.message);
  if (error instanceof ZodError) {
    return answer(
      400,
      error.issues[0]?.message ?? "That request doesn't look right.",
    );
  }
  console.error("[harness]", error);
  return answer(500, "Something went wrong on our side.");
}

export const notFound = (message = "Not found") => answer(404, message);

/** JSON that is never cached: everything here is one Owner's. */
export function json<T>(body: T, init?: { status?: number }): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": "no-store" },
  });
}

/** A request body as JSON, or an empty object when there is none. */
export async function bodyOf(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}

/** The response headers of an NDJSON stream (chat, Run events). */
export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
} as const;
