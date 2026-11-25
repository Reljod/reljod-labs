import "server-only";

/** A cap in `LIMITS` was reached. Routes answer 429. */
export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** The request cannot be done as asked. Routes answer 400. */
export class InvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidError";
  }
}
