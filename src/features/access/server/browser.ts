import "server-only";
import { cookies } from "next/headers";
import { PROFILE_HINT_COOKIE } from "../constants";
import { hostOf, requestCookies } from "./gate";
import type { Browser } from "./ports";
import { authClient, sessionlessAuthClient } from "./supabase";

/**
 * The Browser port over this request's cookies: a Supabase Auth client that
 * keeps its session in them (made on first use, so a door that is not set up
 * never builds one), and the profile hint cookie. For route handlers, which
 * may write cookies.
 */
export function requestBrowser(): Browser {
  let client: ReturnType<typeof authClient> | undefined;
  const session = () => {
    client ??= authClient(requestCookies());
    return client;
  };
  const auth = () => session().auth;
  return {
    async claims() {
      const { data } = await auth().getClaims();
      const sub = data?.claims.sub;
      return sub
        ? { userId: sub, anonymous: !!data.claims.is_anonymous }
        : null;
    },
    async signInAnonymously() {
      const { data, error } = await auth().signInAnonymously();
      if (error || !data.user) {
        console.error("[access] anonymous sign-in failed", error);
        return null;
      }
      return data.user.id;
    },
    async signInWithPassword(email, password) {
      const { error } = await auth().signInWithPassword({ email, password });
      return !error;
    },
    host: () => hostOf(session()),
    async signOut() {
      await auth().signOut({ scope: "local" });
    },
    async setDisplayName(name) {
      const { error } = await auth().updateUser({
        data: { display_name: name },
      });
      if (error) console.error("[access] could not update the profile", error);
      return !error;
    },
    async setPassword(password) {
      const { error } = await auth().updateUser({ password });
      if (!error) return "changed";
      console.error("[access] could not change the password", error);
      return error.code === "weak_password" ? "weak" : "failed";
    },
    async hint(audience) {
      const jar = await cookies();
      if (!audience) {
        jar.delete(PROFILE_HINT_COOKIE);
        return;
      }
      if (jar.get(PROFILE_HINT_COOKIE)?.value === audience) return;
      jar.set(PROFILE_HINT_COOKIE, audience, {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    },
  };
}

/** Checks a password with a client that keeps no session, so this browser's stays as it is. */
export const sessionlessPasswords = {
  async verify(email: string, password: string) {
    const { error } = await sessionlessAuthClient().auth.signInWithPassword({
      email,
      password,
    });
    return !error;
  },
};
