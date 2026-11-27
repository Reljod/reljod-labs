import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { type Owner, parseOwner } from "@/features/access/domain/owner";
import { isE2eToken } from "@/features/access/server/e2e";
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

/**
 * The Owner's Desks, newest activity first. Takes the Owner a caller already
 * got from `requireOwner`, so one request asks the Auth server once.
 */
export async function ownedDesks(owner: Owner) {
  return sessionsOf(owner, MAX_DESKS);
}

/** Opens a fresh Desk and keeps the old ones on the list. */
export async function startSession() {
  const { owner } = await requireOwner();
  const id = await openSession(owner);
  const session = await getSession(id);
  if (!session) throw new Error("Session was not created");
  return { owner, session };
}

/** Goes back to an earlier Desk, if the Owner owns it. */
export async function switchSession(id: string) {
  const { owner } = await requireOwner();
  const session = ownedBy(await getSession(id), owner);
  if (!session) return null;
  await rememberDesk(id);
  return { owner, session };
}

/** How long the desk's chat may use one session token: one message's turn and its tools. */
export const SESSION_TOKEN_SECONDS = 60 * 60;

const TOKEN_PREFIX = "cws1.";

/** What a session token says: the Desk, its Owner (null for the outside client's desk) and until when. */
export type SessionTokenClaims = {
  sessionId: string;
  owner: Owner | null;
  exp: number;
};

const signSession = (payload: string, secret: string) =>
  createHmac("sha256", `casework-mcp-session:${secret}`)
    .update(payload)
    .digest("base64url");

/**
 * A bearer token that lets the MCP server act for one Desk, for its Owner,
 * for an hour. Minted per chat message; never handed to the browser.
 */
export function sessionToken(
  session: { id: string; owner: Owner | null },
  now = Date.now(),
  secret = env.rateLimitSalt(),
) {
  const claims: SessionTokenClaims = {
    sessionId: session.id,
    owner: session.owner,
    exp: Math.floor(now / 1000) + SESSION_TOKEN_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${TOKEN_PREFIX}${payload}.${signSession(payload, secret)}`;
}

/** The claims of a session token signed here and not expired, else null. */
export function verifySessionToken(
  token: string,
  now = Date.now(),
  secret = env.rateLimitSalt(),
): SessionTokenClaims | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [payload, signature, ...rest] = token
    .slice(TOKEN_PREFIX.length)
    .split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(signSession(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<SessionTokenClaims>;
    if (typeof claims.sessionId !== "string" || !claims.sessionId) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (claims.owner !== null && !parseOwner(claims.owner)) return null;
    return {
      sessionId: claims.sessionId,
      owner: claims.owner ?? null,
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Whether a Desk row still belongs to the Owner a session token named. Null
 * matches only null: the outside client's desk, which has no Owner.
 */
export function ownerMatches(rowOwner: Owner | null, tokenOwner: unknown) {
  return (
    (tokenOwner === null || typeof tokenOwner === "string") &&
    rowOwner === tokenOwner
  );
}

export async function visitorHash() {
  const requestHeaders = await headers();
  if (isE2eToken(requestHeaders.get(E2E_HEADER))) {
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
  return (await currentDesk()).session;
}

/** `currentSession`, with the Owner it was checked against. */
export async function currentDesk(): Promise<{
  owner: Owner;
  session: SessionRow | null;
}> {
  const { owner } = await requireOwner();
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  const open = id ? ownedBy(await getSession(id), owner) : null;
  if (open) return { owner, session: open };
  const [latest] = await sessionsOf(owner, 1);
  return { owner, session: latest ?? null };
}

/** The Desk this request works in, created on first use (from a server action or route). */
export async function ensureSession(): Promise<SessionRow> {
  return (await ensureDesk()).session;
}

/** `ensureSession`, with the Owner it was checked against. */
export async function ensureDesk(): Promise<{
  owner: Owner;
  session: SessionRow;
}> {
  const { owner, session } = await currentDesk();
  if (session) return { owner, session };
  const id = await openSession(owner);
  const created = await getSession(id);
  if (!created) throw new Error("Session was not created");
  return { owner, session: created };
}

export { E2E_VISITOR };
