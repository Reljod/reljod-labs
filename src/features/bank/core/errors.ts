import type { Finding } from "../domain/checks";
import type { RuleEditError } from "../domain/rules";

/** The Staff member's Role may not do this. Routes answer 403. */
export class ForbiddenError extends Error {
  name = "ForbiddenError";
}

/** A cap in `LIMITS` was reached. Routes answer 429. */
export class LimitError extends Error {
  name = "LimitError";
}

/** The thing asked for is not in this bank. Routes answer 404. */
export class NotFoundError extends Error {
  name = "NotFoundError";
  constructor(message = "Not found") {
    super(message);
  }
}

/** The request cannot be done as asked. Routes answer 400. */
export class InvalidError extends Error {
  name = "InvalidError";
}

/** The thing is in the wrong state: an account closed, a payment already settled. Routes answer 409. */
export class StateError extends Error {
  name = "StateError";
}

/** A Rule refused the command. Carries the Finding that decided. Routes answer 422. */
export class RuleRefusedError extends Error {
  name = "RuleRefusedError";
  constructor(readonly finding: Finding) {
    super(finding.message);
  }
}

/** A Rule edit that fails its schema: one error per field at fault. Routes answer 400 with `errors`. */
export class RuleEditRefusedError extends InvalidError {
  name = "RuleEditRefusedError";
  constructor(readonly errors: RuleEditError[]) {
    super(errors[0]?.message ?? "That Rule edit doesn't look right.");
  }
}

/** The ledger refused: not enough available funds. Routes answer 422. */
export class InsufficientFundsError extends Error {
  name = "InsufficientFundsError";
}

/** Errors whose message is written for the person and safe to show. */
export const SAFE_ERRORS = [
  ForbiddenError,
  LimitError,
  NotFoundError,
  InvalidError,
  StateError,
  RuleRefusedError,
  InsufficientFundsError,
] as const;

export const isSafeError = (error: unknown): error is Error =>
  SAFE_ERRORS.some((kind) => error instanceof kind);

/**
 * Turns an error raised by the bank's database functions (SQLSTATE BKxxx)
 * into the typed error the app answers with. Anything else is returned as
 * it came. The message of a BK error is written in the migration, for a
 * person, and names no secret.
 */
export function fromDatabase(error: unknown): unknown {
  const code = (error as { code?: unknown })?.code;
  const message = (error as { message?: unknown })?.message;
  if (typeof code !== "string" || typeof message !== "string") return error;
  switch (code) {
    case "BK001":
      return new InsufficientFundsError(message);
    case "BK002":
    case "BK409":
      return new StateError(message);
    case "BK400":
      return new InvalidError(message);
    case "BK404":
      return new NotFoundError(message);
    default:
      return error;
  }
}
