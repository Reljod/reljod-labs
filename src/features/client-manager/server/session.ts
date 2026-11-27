import "server-only";
import { headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { isE2eToken } from "@/features/access/server/e2e";
import { requireOwner } from "@/features/access/server/gate";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { env } from "./env";

/** Visitors tagged this way (the e2e suite and the seed script) skip limits. */
export const TRUSTED_VISITOR = "e2e";

export type Visitor = { hash: string; trusted: boolean };

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  if (isE2eToken(requestHeaders.get(E2E_HEADER))) {
    return { hash: TRUSTED_VISITOR, trusted: true };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

/**
 * Whose clients and Threads this request reaches: the Access Owner. Every
 * Client Manager route reads it here, so this is where they all pass the
 * Access gate: no route can reach the model or the graph without it. A
 * Guest's devices share their Guest pass's Owner, and a Host's browsers share
 * theirs, so saved data never depends on a browser cookie.
 */
export async function currentOwner(): Promise<Owner> {
  const { owner } = await requireOwner();
  return owner;
}
