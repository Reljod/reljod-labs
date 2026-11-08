import "server-only";
import { headers } from "next/headers";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { env } from "./env";

/** e2e only: plan from canned Build plans instead of calling the model. */
export const STUB_HEADER = "x-ledger-stub";
/** e2e only: behave as if the visitor were over the rate limit. */
export const FORCE_LIMIT_HEADER = "x-ledger-force-limit";

export type Visitor = {
  hash: string;
  /** Subject to rate limits. */
  limited: boolean;
  stubbed: boolean;
  forceLimit: boolean;
};

export async function currentVisitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass) {
    return {
      hash: E2E_VISITOR,
      limited: false,
      stubbed: requestHeaders.get(STUB_HEADER) === "1",
      forceLimit: requestHeaders.get(FORCE_LIMIT_HEADER) === "1",
    };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return {
    hash: hashVisitor(ip, env.rateLimitSalt()),
    limited: true,
    stubbed: false,
    forceLimit: false,
  };
}
