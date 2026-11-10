import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { E2E_HEADER } from "@/features/document-compliance/constants";
import { DENIED_MESSAGE } from "../constants";
import { guestPassStatus } from "../domain/guest-pass";
import { env } from "./env";
import { guestPassOf } from "./repository";
import { type AuthCookies, authClient } from "./supabase";

/** Why a request may use the demos. */
export type Access =
  | { kind: "host"; userId: string; email: string }
  | {
      kind: "guest";
      userId: string;
      passId: string;
      label: string;
      expiresAt: string;
    }
  /** The Playwright suite, carrying `E2E_BYPASS_TOKEN`. */
  | { kind: "e2e" };

export class AccessDeniedError extends Error {
  constructor() {
    super(DENIED_MESSAGE);
    this.name = "AccessDeniedError";
  }
}

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The signed-in account, if it is a Host: confirmed, and on the Host list. */
export async function hostOf(client: SupabaseClient) {
  // Asks the Auth server, so a deleted or banned account stops being a Host.
  const { data, error } = await client.auth.getUser();
  const user = data?.user;
  if (error || !user || user.is_anonymous) return null;
  const email = user.email?.toLowerCase();
  if (!email || !user.email_confirmed_at) return null;
  if (!env.hostEmails().includes(email)) return null;
  return { kind: "host" as const, userId: user.id, email };
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
  const bypass = env.e2eBypassToken();
  if (bypass && door.e2eToken && sameSecret(door.e2eToken, bypass)) {
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

/** The Access of the current request, or null. */
export async function currentAccess() {
  return accessThrough({
    e2eToken: (await headers()).get(E2E_HEADER),
    cookies: requestCookies(),
  });
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
