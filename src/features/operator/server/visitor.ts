import "server-only";
import { headers } from "next/headers";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { env } from "./env";

/** Who is spending: a salted hash of the IP, never an Owner. Rate limits stay on it. */
export type Visitor = { hash: string; trusted: boolean };

export { E2E_VISITOR };

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass) {
    return { hash: E2E_VISITOR, trusted: true };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}
