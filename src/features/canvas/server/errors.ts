import "server-only";
import type { RuleEditError } from "../domain/rules";

/** A cap in `LIMITS` was reached. Routes answer 429. */
export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** The thing asked for is not this Owner's. Routes answer 404. */
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

/** The Guard or a check refused, under a Rule. Routes answer 400 with the Rule. */
export class RuleRefusal extends InvalidError {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message);
    this.name = "RuleRefusal";
  }
}

/** A Rule edit that fails its schema. Routes answer 400 with `errors`. */
export class RuleEditRefused extends InvalidError {
  constructor(readonly errors: RuleEditError[]) {
    super(errors[0]?.message ?? "That Rule edit doesn't look right.");
    this.name = "RuleEditRefused";
  }
}

/** The thing is in the wrong state. Routes answer 409. */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

/** The Sandbox cannot be reached. Routes answer 503. */
export class SandboxUnavailable extends Error {
  constructor(message = "Sandbox unavailable") {
    super(message);
    this.name = "SandboxUnavailable";
  }
}

/** Errors whose message is written for the person, so it may be shown. */
export function isSafeError(error: unknown): error is Error {
  return (
    error instanceof LimitError ||
    error instanceof NotFoundError ||
    error instanceof InvalidError ||
    error instanceof StateError ||
    error instanceof SandboxUnavailable
  );
}
