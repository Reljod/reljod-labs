import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { requireOwner } from "@/features/access/server/gate";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import {
  E2E_VISITOR,
  hashVisitor,
} from "@/features/document-compliance/server/rate-limit";
import { env } from "./env";
import {
  createSession,
  getSession,
  type SessionRow,
  sessionsOf,
} from "./repository";

/**
 * Which of the Owner's Desks this browser has open. Only a pointer: a Desk is
 * opened only when its Owner is the request's Owner, so the cookie never
 * reaches someone else's Desk.
 */
export const SESSION_COOKIE = "casework_session";
/** How many earlier Desks the list offers to go back to. */
const MAX_DESKS = 12;

const COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
};

async function rememberDesk(id: string) {
  try {
    (await cookies()).set(SESSION_COOKIE, id, COOKIE);
  } catch {
    // A page render cannot write cookies; the next action will.
  }
}

async function openSession(owner: Owner) {
  const { hash } = await visitorHash();
  const id = await createSession(hash, owner);
  await rememberDesk(id);
  return id;
}

/** The Desk, if the Owner owns it. */
function ownedBy(session: SessionRow | null, owner: Owner) {
  return session && session.owner === owner ? session : null;
}

/*
 * Every way to a Desk passes the Access gate here, through `requireOwner`,
 * so no server action or route of the desk can reach the model without it.
 */

/** The Owner's Desks, newest activity first. */
export async function ownedDesks() {
  const { owner } = await requireOwner();
  return sessionsOf(owner, MAX_DESKS);
}

/** Opens a fresh Desk and keeps the old ones on the list. */
export async function startSession() {
  const { owner } = await requireOwner();
  return openSession(owner);
}

/** Goes back to an earlier Desk, if the Owner owns it. */
export async function switchSession(id: string) {
  const { owner } = await requireOwner();
  if (!ownedBy(await getSession(id), owner)) return false;
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

/**
 * The Desk this request works in: the one this browser has open, if the Owner
 * owns it, or else the Owner's latest, so a Guest's other devices and a Host's
 * other browsers pick up where they left off.
 */
export async function currentSession(): Promise<SessionRow | null> {
  const { owner } = await requireOwner();
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  const open = id ? ownedBy(await getSession(id), owner) : null;
  if (open) return open;
  const [latest] = await sessionsOf(owner, 1);
  return latest ?? null;
}

/** The Desk this request works in, created on first use (from a server action or route). */
export async function ensureSession(): Promise<SessionRow> {
  const existing = await currentSession();
  if (existing) return existing;
  const { owner } = await requireOwner();
  const id = await openSession(owner);
  const session = await getSession(id);
  if (!session) throw new Error("Session was not created");
  return session;
}

export { E2E_VISITOR };
