import "server-only";
import type { RuleEditError } from "../domain/rules";

/** A cap in `LIMITS` was reached. Routes answer 429. */
export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** Not in this Workspace. Routes answer 404. */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The request cannot be done as asked. Routes answer 400. */
export class InvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidError";
  }
}

/** A Rule edit that fails its schema. Routes answer 400 with `errors`. */
export class RuleRefusedError extends InvalidError {
  constructor(readonly errors: RuleEditError[]) {
    super(errors[0]?.message ?? "That Rule edit doesn't look right.");
    this.name = "RuleRefusedError";
  }
}

/** The Call is in the wrong state: already over, or cut off. Routes answer 409. */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
