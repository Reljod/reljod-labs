import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/features/access/server/env";
import type { RequestMode } from "./mode";

/**
 * Who is spending: a salted hash of the IP, never an Owner. Rate limits count
 * against it; saved data never does. `trusted` is the e2e suite, which no
 * visitor cap applies to.
 */
export type Visitor = { hash: string; trusted: boolean };

export function hashVisitor(ip: string, salt: string) {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** The first hop Vercel saw, else `unknown` (every unknown visitor shares one bucket). */
export function clientIp(headers: Pick<Headers, "get">): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export function visitorOf(
  headers: Pick<Headers, "get">,
  mode: RequestMode,
): Visitor {
  if (mode.e2e) return { hash: "e2e", trusted: true };
  return {
    hash: hashVisitor(clientIp(headers), env.rateLimitSalt()),
    trusted: false,
  };
}
