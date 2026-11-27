import "server-only";
import { headers } from "next/headers";
import { isE2eToken } from "@/features/access/server/e2e";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { env } from "./env";

/** Who is spending: a salted hash of the IP, never an Owner. Rate limits stay on it. */
export type Visitor = { hash: string; trusted: boolean };

export { E2E_VISITOR };

/** The visitor of the current request, and where the request came in (for Sample files). */
export async function visitor(): Promise<Visitor & { origin: string }> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.")
      ? "http"
      : "https");
  const origin = host ? `${proto}://${host}` : "";
  if (isE2eToken(requestHeaders.get(E2E_HEADER))) {
    return { hash: E2E_VISITOR, trusted: true, origin };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false, origin };
}
