import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { DENIED_MESSAGE } from "@/features/access/constants";
import { AccessDeniedError } from "@/features/access/server/gate";
import { LimitError, ProviderUnavailableError } from "./errors";

export const NO_STORE = "private, no-store";

export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": `${NO_STORE}, no-transform`,
  "x-accel-buffering": "no",
} as const;

function answer(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": NO_STORE },
  });
}

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": NO_STORE },
  });
}

export async function bodyOf(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}

/**
 * Normalizes route errors to safe JSON payloads. Never exposes stack traces.
 */
export function failure(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) {
    return answer(401, { error: DENIED_MESSAGE });
  }
  if (error instanceof LimitError) {
    return answer(429, { error: error.message });
  }
  if (error instanceof ProviderUnavailableError) {
    return answer(503, { error: error.message });
  }
  if (error instanceof ZodError) {
    return answer(400, {
      error: error.issues[0]?.message ?? "That request doesn't look right.",
    });
  }
  console.error("[prism]", error);
  return answer(500, { error: "Could not complete that decision pass." });
}
