import "server-only";
import { headers } from "next/headers";
import { isE2eToken } from "@/features/access/server/e2e";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { E2E_HEADER } from "@/platform/request/headers";
import { env } from "./env";

/** Who is spending: a salted hash of the IP, never an Owner. Rate limits stay on it. */
export type Visitor = { hash: string; trusted: boolean };

export { E2E_VISITOR };

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  if (isE2eToken(requestHeaders.get(E2E_HEADER))) {
    return { hash: E2E_VISITOR, trusted: true };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}
