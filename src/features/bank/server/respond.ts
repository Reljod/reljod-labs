import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";
import {
  ForbiddenError,
  InsufficientFundsError,
  InvalidError,
  LimitError,
  NotFoundError,
  RuleEditRefusedError,
  RuleRefusedError,
  StateError,
} from "../core/errors";

/** Everything the bank answers is one Owner's and can change. */
export const NO_STORE = "private, no-store";

export function json<T>(body: T, init?: { status?: number }): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": NO_STORE },
  });
}

/** The status and words for an error, or null when it is not one a person may read. */
export function refusalOf(
  error: unknown,
): { status: number; message: string; errors?: unknown } | null {
  if (error instanceof ForbiddenError)
    return { status: 403, message: error.message };
  if (error instanceof NotFoundError)
    return { status: 404, message: error.message };
  if (error instanceof StateError)
    return { status: 409, message: error.message };
  if (error instanceof LimitError)
    return { status: 429, message: error.message };
  if (
    error instanceof RuleRefusedError ||
    error instanceof InsufficientFundsError
  ) {
    return { status: 422, message: error.message };
  }
  if (error instanceof RuleEditRefusedError) {
    return { status: 400, message: error.message, errors: error.errors };
  }
  if (error instanceof InvalidError)
    return { status: 400, message: error.message };
  if (error instanceof ZodError) {
    return {
      status: 400,
      message: error.issues[0]?.message ?? "That request doesn't look right.",
    };
  }
  return null;
}

/**
 * Turns what a bank route handler threw into its JSON answer. Never a stack
 * or a server message: those stay in the log.
 */
export function failure(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  const refusal = refusalOf(error);
  if (refusal) {
    return json(
      {
        error: refusal.message,
        ...(refusal.errors ? { errors: refusal.errors } : {}),
      },
      { status: refusal.status },
    );
  }
  console.error("[bank]", error);
  return json({ error: "Something went wrong on our side." }, { status: 500 });
}

export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": `${NO_STORE}, no-transform`,
  "x-accel-buffering": "no",
} as const;
