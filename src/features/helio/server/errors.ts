/**
 * An error whose message was written for the person: a bad input the studio
 * refuses (an unknown Sample, an image it cannot read). Only these, and the
 * rate limit, reach the browser with their own words; anything else is
 * logged and answered with a generic message (`publicMessage`).
 */
export class HelioInputError extends Error {}

/** The words the browser may see for an error: its own for a known one, `fallback` otherwise (the cause is logged). */
export function publicMessage(error: unknown, fallback: string): string {
  if (error instanceof HelioInputError && error.message)
    return error.message.slice(0, 260);
  console.error(
    "[helio]",
    fallback,
    error instanceof Error ? error.message : String(error),
  );
  return fallback;
}
