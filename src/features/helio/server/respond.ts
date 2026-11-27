import "server-only";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { isE2eToken } from "@/features/access/server/e2e";
import { AccessDeniedError, denied } from "@/features/access/server/gate";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { HelioInputError, publicMessage } from "./errors";
import { RateLimitError } from "./rate";

export const NO_STORE = { "cache-control": "private, no-store" } as const;
export const HELIO_STUB_HEADER = "x-helio-stub";

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/**
 * Only requests presenting BOTH the valid `E2E_BYPASS_TOKEN` and `x-helio-stub: 1`
 * receive deterministic stubbed outputs without calling paid models.
 */
export function isStubRequest(request: Request): boolean {
  if (!isE2eToken(request.headers.get(E2E_HEADER))) return false;
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
  if (error instanceof HelioInputError)
    return NextResponse.json(
      { error: publicMessage(error, "That request could not be read.") },
      { status: 400, headers: NO_STORE },
    );
  return NextResponse.json(
    {
      error: publicMessage(error, "The studio request could not be completed."),
    },
    { status: 500, headers: NO_STORE },
  );
}
