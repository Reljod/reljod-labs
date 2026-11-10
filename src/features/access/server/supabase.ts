import "server-only";
import { type CookieMethodsServer, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: ReturnType<typeof createServiceClient> | undefined;

function createServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    db: { schema: "access" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client: server code only, bypasses RLS on the `access` schema. */
export function supabase() {
  client ??= createServiceClient();
  return client;
}

/**
 * An Auth client that keeps no session: for checking a password without
 * touching the session this browser already has.
 */
export function sessionlessAuthClient() {
  return createClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export type AuthCookies = CookieMethodsServer;

/**
 * A Supabase Auth client for one request, with the session kept in cookies.
 * Made with the publishable key: it signs people in and reads who they are,
 * and never touches data. The cookies are httpOnly because no browser code
 * needs the session.
 */
export function authClient(cookies: AuthCookies) {
  return createServerClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    cookies,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  });
}
