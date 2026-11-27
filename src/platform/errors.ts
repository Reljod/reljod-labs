/**
 * The errors a service throws on purpose. Each carries the HTTP status the
 * REST layer answers with and a message that is safe to show a visitor, so a
 * service never imports anything HTTP and every entry point (route, MCP tool,
 * workflow step) maps a refusal the same way. Anything else that is thrown is
 * a bug: it is logged and answered as a 500 with no detail.
 */
export abstract class AppError extends Error {
  abstract readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429;
  /** Extra JSON fields the answer carries beside `error` (field errors, a retry hint). */
  readonly extra: Record<string, unknown> | undefined;

  constructor(message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.extra = extra;
  }
}

/** The request cannot be done as asked. */
export class InvalidError extends AppError {
  readonly status = 400;
}

/** No Access: not a Host, and not a Guest on a live Guest pass. */
export class UnauthorizedError extends AppError {
  readonly status = 401;
}

/** Signed in, but not allowed to do this (a Role, a Host-only page). */
export class ForbiddenError extends AppError {
  readonly status = 403;
}

/** Not there, or not the caller's: the two answer the same, so ids leak nothing. */
export class NotFoundError extends AppError {
  readonly status = 404;
  constructor(message = "Not found", extra?: Record<string, unknown>) {
    super(message, extra);
  }
}

/** The thing is in the wrong state: a Run already ended, an Approval already decided. */
export class ConflictError extends AppError {
  readonly status = 409;
}

/** The body is larger than the route accepts. */
export class TooLargeError extends AppError {
  readonly status = 413;
}

/** A cap in a feature's `LIMITS` was reached. */
export class LimitError extends AppError {
  readonly status = 429;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
