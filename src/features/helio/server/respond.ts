import "server-only";
import { timingSafeEqual } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { AccessDeniedError, denied } from "@/features/access/server/gate";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { env } from "./env";
import { RateLimitError } from "./rate";

export const NO_STORE = { "cache-control": "private, no-store" } as const;
export const HELIO_STUB_HEADER = "x-helio-stub";

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Only requests presenting BOTH the valid `E2E_BYPASS_TOKEN` and `x-helio-stub: 1`
 * receive deterministic stubbed outputs without calling paid models.
 */
export function isStubRequest(request: Request): boolean {
  const expected = env.e2eBypassToken();
  if (!expected) return false;
  const given = request.headers.get(E2E_HEADER);
  if (!given || !sameSecret(given, expected)) return false;
  return request.headers.get(HELIO_STUB_HEADER) === "1";
}

export function failure(error: unknown) {
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return denied();
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: error.message },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "retry-after": String(error.retryAfterSeconds),
        },
      },
    );
  }
  const message =
    error instanceof Error && error.message
      ? error.message
      : "The studio request could not be completed.";
  const safeMessage =
    message.length > 260 ? `${message.slice(0, 260)}…` : message;
  return NextResponse.json(
    { error: safeMessage },
    { status: 500, headers: NO_STORE },
  );
}
