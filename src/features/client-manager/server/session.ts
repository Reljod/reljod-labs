import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { requireAccess } from "@/features/access/server/gate";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { env } from "./env";

export const SESSION_COOKIE = "client_manager_session";

/** Visitors tagged this way (the e2e suite and the seed script) skip limits. */
export const TRUSTED_VISITOR = "e2e";

export type Visitor = { hash: string; trusted: boolean };

export async function visitor(): Promise<Visitor> {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass) {
    return { hash: TRUSTED_VISITOR, trusted: true };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), trusted: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This browser's session id, if it has one. Every Client Manager route reads
 * the session here (or through `ensureSessionId`), so this is where they all
 * pass the Access gate: no route can reach the model or the graph without it.
 */
export async function currentSessionId(): Promise<string | null> {
  await requireAccess();
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value && UUID.test(value) ? value : null;
}

/** This browser's session id, set on first use. Route handlers and actions only. */
export async function ensureSessionId(): Promise<string> {
  const existing = await currentSessionId();
  if (existing) return existing;
  const id = randomUUID();
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return id;
}
