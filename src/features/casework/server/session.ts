import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { env } from "./env";
import { createSession, getSession, type SessionRow } from "./repository";

export const SESSION_COOKIE = "casework_session";
/** Every desk this browser has opened, newest first, so it can go back to one. */
export const DESKS_COOKIE = "casework_desks";
const MAX_DESKS = 12;

const COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
};

/** The ids of the desks this browser owns. */
export async function deskIds() {
  const jar = await cookies();
  const listed = (jar.get(DESKS_COOKIE)?.value ?? "")
    .split(".")
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const current = jar.get(SESSION_COOKIE)?.value;
  return [...new Set([...(current ? [current] : []), ...listed])].slice(
    0,
    MAX_DESKS,
  );
}

async function rememberDesk(id: string) {
  const jar = await cookies();
  const ids = [...new Set([id, ...(await deskIds())])].slice(0, MAX_DESKS);
  jar.set(SESSION_COOKIE, id, COOKIE);
  jar.set(DESKS_COOKIE, ids.join("."), COOKIE);
}

/** Opens a fresh desk and keeps the old ones on the list. */
export async function startSession() {
  const { hash } = await visitorHash();
  const id = await createSession(hash);
  await rememberDesk(id);
  return id;
}

/** Goes back to an earlier desk, if this browser owns it. */
export async function switchSession(id: string) {
  if (!(await deskIds()).includes(id)) return false;
  if (!(await getSession(id))) return false;
  await rememberDesk(id);
  return true;
}

/** A bearer token that lets the MCP server act for one session. */
export function sessionToken(sessionId: string) {
  const signature = createHmac("sha256", env.rateLimitSalt())
    .update(`casework-mcp:${sessionId}`)
    .digest("base64url");
  return `${sessionId}.${signature}`;
}

export function verifySessionToken(token: string) {
  const [sessionId] = token.split(".");
  if (!sessionId) return null;
  const expected = Buffer.from(sessionToken(sessionId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? sessionId
    : null;
}

export async function visitorHash() {
  const requestHeaders = await headers();
  const bypass = env.e2eBypassToken();
  if (bypass && requestHeaders.get(E2E_HEADER) === bypass) {
    return { hash: E2E_VISITOR, limited: false };
  }
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return { hash: hashVisitor(ip, env.rateLimitSalt()), limited: true };
}

/** This browser's desk session, if it has one. */
export async function currentSession(): Promise<SessionRow | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  return id ? getSession(id) : null;
}

/** This browser's desk session, created on first use (from a server action or route). */
export async function ensureSession(): Promise<SessionRow> {
  const existing = await currentSession();
  if (existing) return existing;
  const id = await startSession();
  const session = await getSession(id);
  if (!session) throw new Error("Session was not created");
  return session;
}

export { E2E_VISITOR };
