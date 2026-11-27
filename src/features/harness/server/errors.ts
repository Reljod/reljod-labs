import "server-only";
import { ConflictError, ForbiddenError, InvalidError } from "@/platform/errors";
import { type Action, refusalFor } from "../domain/permissions";
import type { RuleEditError } from "../domain/rules";
import type { Staff } from "../domain/staff";

/*
 * Harness throws the platform's errors (`@/platform/errors`): 400 Invalid,
 * 403 Forbidden, 404 NotFound, 409 Conflict (a Run already ended, an
 * Approval already decided), 429 Limit. Only what is Harness's own is here.
 */

/**
 * Throws the 403 that names the Role the action needs, unless `can()`
 * allows it. For a service handed a Staff member (the REST policy
 * `permits()` refuses the same way before a route's body is read).
 */
export function assertCan(staff: Pick<Staff, "role">, action: Action): void {
  const refusal = refusalFor(staff, action);
  if (refusal !== null) throw new ForbiddenError(refusal);
}

/** The Sandbox cannot be reached or failed: a 409 whose message the Agent can act on. */
export function sandboxUnavailable(reason: string): ConflictError {
  return new ConflictError(`Sandbox unavailable: ${reason}`);
}

/**
 * A file that cannot be turned into text, with why in words a person can
 * act on. Not an AppError: the Knowledge service records it on the Source
 * (`failed`) and answers the Source, not a refusal.
 */
export class UnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableError";
  }
}

/** A Source claimed for reading changed meanwhile (removed, or taken over by a later read). */
export class SourceChangedError extends Error {}

/** A Rule edit that fails its schema: 400, with one error per field at fault in `errors`. */
export class RuleRefusedError extends InvalidError {
  constructor(readonly errors: RuleEditError[]) {
    super(errors[0]?.message ?? "That Rule edit doesn't look right.", {
      errors,
    });
  }
}
