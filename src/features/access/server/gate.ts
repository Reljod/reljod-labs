import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { E2E_HEADER } from "@/platform/request/headers";
import { DENIED_MESSAGE } from "../constants";
import { guestPassStatus } from "../domain/guest-pass";
import { type Owner, ownerOf } from "../domain/owner";
import { isE2eToken } from "./e2e";
import { env } from "./env";
import { AccessDeniedError } from "./errors";
import { FORWARDED_ACCESS_HEADER, forwardedAccess } from "./forwarded";
import { guestPassOf } from "./repository";
import { type AuthCookies, authClient, supabase } from "./supabase";

/** Why a request may use the demos. */
export type Access =
  | { kind: "host"; userId: string; email: string; name: string }
  | {
      kind: "guest";
      userId: string;
      passId: string;
      label: string;
      expiresAt: string;
    }
  /** The Playwright suite, carrying `E2E_BYPASS_TOKEN`. */
  | { kind: "e2e" };

export { AccessDeniedError };

/**
 * The account, if it is a Host: not anonymous or banned, its email confirmed
 * and on the Host list.
 */
function hostFrom(user: User | null | undefined, now = Date.now()) {
  if (!user || user.is_anonymous) return null;
  if (user.banned_until && Date.parse(user.banned_until) > now) return null;
  const email = user.email?.toLowerCase();
  if (!email || !user.email_confirmed_at) return null;
  if (!env.hostEmails().includes(email)) return null;
  // The name is the Host's own to edit, so it is shown and never trusted.
  const name = user.user_metadata?.display_name;
  return {
    kind: "host" as const,
    userId: user.id,
    email,
    name: typeof name === "string" ? name : "",
  };
}

/** The signed-in account, if it is a Host: confirmed, and on the Host list. */
export async function hostOf(client: SupabaseClient) {
  // Asks the Auth server, so a deleted or banned account stops being a Host.
  const { data, error } = await client.auth.getUser();
  return error ? null : hostFrom(data?.user);
}

/**
 * The account with this id, if it is a Host now. For callers that carry no
 * Auth cookies (the Guest access MCP server's bearer): asks the Auth admin
 * API, so a deleted, banned or delisted account stops at once.
 */
export async function hostById(userId: string) {
  const { data, error } = await supabase().auth.admin.getUserById(userId);
  if (error) {
    // A missing user is an answer; anything else is the Auth server failing.
    if (error.status === 404 || error.code === "user_not_found") return null;
    throw new Error(`Could not look up the Host: ${error.message}`, {
      cause: error,
    });
  }
  return hostFrom(data?.user);
}

/**
 * Works out the Access of a request from its e2e header and Auth cookies.
 * An Auth session alone opens nothing: anyone can become an anonymous user,
 * so a Guest counts only while bound to a live Guest pass, and an account
 * counts only as a Host.
 */
export async function accessThrough(door: {
  e2eToken: string | null;
  cookies: AuthCookies;
}): Promise<Access | null> {
  if (isE2eToken(door.e2eToken)) {
    return { kind: "e2e" };
  }
  if (!env.supabasePublishableKey()) return null;
  // No Auth cookie, nobody to ask about: an anonymous visit costs no lookup.
  const jar = (await door.cookies.getAll()) ?? [];
  if (!jar.some((cookie) => cookie.name.startsWith("sb-"))) return null;

  const client = authClient(door.cookies);
  // Verifies the token's signature, refreshing the session if it is due.
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) return null;

  if (data.claims.is_anonymous) {
    const pass = await guestPassOf(data.claims.sub);
    if (!pass) return null;
    const status = guestPassStatus({
      expiresAt: pass.expires_at,
      revokedAt: pass.revoked_at,
      deletedAt: pass.deleted_at,
    });
    if (status !== "live") return null;
    return {
      kind: "guest",
      userId: data.claims.sub,
      passId: pass.id,
      label: pass.label,
      expiresAt: pass.expires_at,
    };
  }
  return hostOf(client);
}

/** Auth cookies of the current request, for server actions, routes and pages. */
export function requestCookies(): AuthCookies {
  return {
    getAll: async () => (await cookies()).getAll(),
    setAll: async (items) => {
      try {
        const jar = await cookies();
        for (const { name, value, options } of items) {
          jar.set(name, value, options);
        }
      } catch {
        // A page render cannot write cookies; the proxy refreshes the session.
      }
    },
  };
}

/**
 * The Access of the current request, or null. The proxy's own answer, when it
 * forwarded one (`forwarded.ts`), saves the JWT check and the Host or Guest
 * pass lookup a second time.
 */
export async function currentAccess() {
  const requestHeaders = await headers();
  return (
    forwardedAccess(requestHeaders.get(FORWARDED_ACCESS_HEADER)) ??
    accessThrough({
      e2eToken: requestHeaders.get(E2E_HEADER),
      cookies: requestCookies(),
    })
  );
}

/**
 * The gate every demo entry point passes: throws unless the request has
 * Access. Call it in the server function itself. The proxy also turns
 * visitors away, but a server action can be posted to any page.
 */
export async function requireAccess() {
  const access = await currentAccess();
  if (!access) throw new AccessDeniedError();
  return access;
}

/**
 * The gate for any read or write of saved demo data: the Access, and the
 * Owner every row must be scoped to. Never scope saved data by a browser
 * cookie: a Guest's devices and a Host's browsers share one Owner.
 */
export async function requireOwner(): Promise<{
  access: Access;
  owner: Owner;
}> {
  const access = await requireAccess();
  return { access, owner: ownerOf(access) };
}

/** The gate for issuing and revoking Guest passes. */
export async function requireHost() {
  const access = await currentAccess();
  if (access?.kind !== "host") throw new AccessDeniedError();
  return access;
}

/** What a route handler answers when the gate refuses. */
export function denied() {
  return new Response(DENIED_MESSAGE, {
    status: 401,
    headers: { "cache-control": "no-store" },
  });
}

/** For route handlers: the Access, or the response to return instead. */
export async function accessOrDenied() {
  return (await currentAccess()) ?? denied();
}
