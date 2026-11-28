import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  isAppError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { Finding } from "../domain/checks";
import type { RuleEditError } from "../domain/rules";

/*
 * The bank's refusals are the platform's errors (`src/platform/errors.ts`),
 * so the REST routes, the MCP server and the Teller all answer them the same
 * way. Only the refusals that carry something of the bank's own are
 * subclasses here.
 */
export { ForbiddenError, InvalidError, LimitError, NotFoundError };

/** The thing is in the wrong state: an account closed, a payment already settled. Answers 409. */
export class StateError extends ConflictError {}

/**
 * A Rule refused the command. Carries the Finding that decided. Answers 403:
 * a Rule is a policy, refused like a Role is.
 */
export class RuleRefusedError extends ForbiddenError {
  constructor(readonly finding: Finding) {
    super(finding.message);
  }
}

/** A Rule edit that fails its schema: one error per field at fault. Answers 400 with `errors`. */
export class RuleEditRefusedError extends InvalidError {
  constructor(readonly errors: RuleEditError[]) {
    super(errors[0]?.message ?? "That Rule edit doesn't look right.", {
      errors,
    });
  }
}

/** The ledger refused: not enough available funds. Answers 409. */
export class InsufficientFundsError extends ConflictError {}

/** Errors whose message is written for the person and safe to show. */
export const isSafeError = (error: unknown): error is Error =>
  isAppError(error);

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
