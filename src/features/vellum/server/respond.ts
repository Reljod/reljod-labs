import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";
import { InvalidError, LimitError } from "./errors";

/** Every Vellum answer is one visitor's, and can change. */
export const NO_STORE = "private, no-store";

const answer = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": NO_STORE } });

/**
 * Turns what a Vellum route handler threw into the JSON answer the contract
 * promises (`domain/api.ts`), so every route fails the same way and never
 * returns a stack trace or a cause.
 */
export function failure(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof LimitError) return answer(429, error.message);
  if (error instanceof InvalidError) return answer(400, error.message);
  if (error instanceof ZodError)
    return answer(
      400,
      error.issues[0]?.message ?? "That request doesn't look right.",
    );
  console.error("[vellum]", error);
  return answer(500, "Something went wrong on our side.");
}

/** JSON that is never cached. */
export function json<T>(body: T): Response {
  return Response.json(body, { headers: { "cache-control": NO_STORE } });
}

/** The response headers of an NDJSON stream (a Pass). */
export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": `${NO_STORE}, no-transform`,
  "x-accel-buffering": "no",
} as const;
