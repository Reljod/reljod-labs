"use server";

import { createHash, randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { hashVisitor } from "@/features/document-compliance/server/rate-limit";
import { ACCESS_PATH, PROFILE_HINT_COOKIE, PROFILE_PATH } from "../constants";
import type { Audience } from "../domain/audience";
import {
  CODE_LENGTH,
  guestCodeFrom,
  normalizeGuestCode,
} from "../domain/guest-code";
import {
  extendedExpiry,
  guestPassStatus,
  LIMITS,
  parseDisplayName,
  parseDuration,
  parseGuestPassRequest,
  passwordProblem,
  safeNextPath,
} from "../domain/guest-pass";
import { trackAccess } from "./analytics";
import { env } from "./env";
import { currentAccess, hostOf, requestCookies, requireHost } from "./gate";
import {
  codeLooksGood,
  countLivePasses,
  deleteGuest,
  extendGuestPass as extendPass,
  guestPassById,
  insertGuestPass,
  markGuestPassDeleted,
  recordAttempt,
  redeem,
  replaceGuestCode,
  restoreGuestPass as restorePass,
  revokeGuestPass as revokePass,
  tooManyAttempts,
} from "./repository";
import { authClient, sessionlessAuthClient } from "./supabase";

export type DoorState = { error: string } | null;

const WAIT = `Too many tries. Wait ${LIMITS.attemptWindowMinutes} minutes and try again.`;
const BAD_CODE =
  "That code did not open the door. It may be mistyped, expired, or already in use on as many devices as it allows.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

async function visitorHash() {
  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  return hashVisitor(ip, env.rateLimitSalt());
}

/**
 * Tells the header's profile menu there is, or no longer is, someone to show,
 * and Web Analytics which Audience this browser is in. Pass null on the way out.
 */
async function hintProfile(audience: Exclude<Audience, "visitor"> | null) {
  const jar = await cookies();
  if (!audience) return jar.delete(PROFILE_HINT_COOKIE);
  if (jar.get(PROFILE_HINT_COOKIE)?.value === audience) return;
  jar.set(PROFILE_HINT_COOKIE, audience, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export type Profile =
  | { kind: "host"; email: string; name: string }
  | { kind: "guest"; label: string; expiresAt: string }
  | null;

/** Who this browser is, for the header's profile menu. Null for a visitor. */
export async function currentProfile(): Promise<Profile> {
  const access = await currentAccess();
  if (access?.kind === "host") {
    await hintProfile("host");
    return { kind: "host", email: access.email, name: access.name };
  }
  if (access?.kind === "guest") {
    await hintProfile("guest");
    return { kind: "guest", label: access.label, expiresAt: access.expiresAt };
  }
  if (!access) await hintProfile(null);
  return null;
}

const UNAVAILABLE =
  "The door is not working right now, so nobody can be let in. Try again in a moment.";

/**
 * A production build hides a thrown Server Action error behind a bare error
 * page, so a failure at the door (Supabase down, the `access` schema not
 * exposed) is logged and told to the visitor instead. Nobody is let in.
 */
async function atTheDoor(work: () => Promise<DoorState>): Promise<DoorState> {
  try {
    return await work();
  } catch (error) {
    // Redirects are thrown too; let them through.
    unstable_rethrow(error);
    console.error("[access] the door failed", error);
    return { error: UNAVAILABLE };
  }
}

/** A Guest enters a code: this browser becomes a Guest on that pass. */
export async function redeemGuestCode(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  return atTheDoor(() => redeemCode(form));
}

async function redeemCode(form: FormData): Promise<DoorState> {
  const next = safeNextPath(form.get("next"));
  const access = await currentAccess();
  if (access && access.kind !== "guest") redirect(next);

  const visitor = await visitorHash();
  if (await tooManyAttempts(visitor, "code")) return { error: WAIT };
  const code = normalizeGuestCode(String(form.get("code") ?? ""));
  if (!code) {
    await recordAttempt(visitor, "code", false);
    return { error: BAD_CODE };
  }
  if (!env.supabasePublishableKey()) {
    console.error("[access] SUPABASE_PUBLISHABLE_KEY is not set");
    return { error: "Guest access is not set up yet." };
  }

  const codeHash = hashCode(code);
  const client = authClient(requestCookies());
  const { data: claims } = await client.auth.getClaims();
  const returning = claims?.claims.is_anonymous ? claims.claims.sub : null;

  // Looked up before anything is created, so a wrong code makes no Auth user.
  if (!(await codeLooksGood(codeHash, returning))) {
    await recordAttempt(visitor, "code", false);
    return { error: BAD_CODE };
  }

  let userId = returning;
  if (!userId) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) {
      console.error("[access] anonymous sign-in failed", error);
      return {
        error: "Guest access is not available right now. Try again soon.",
      };
    }
    userId = data.user.id;
  }

  const pass = await redeem({ codeHash, userId, visitorHash: visitor });
  await recordAttempt(visitor, "code", pass !== null);
  if (!pass) {
    // Lost a race for the last device, or the pass ended a moment ago.
    if (!returning) {
      await client.auth.signOut({ scope: "local" });
      await deleteGuest(userId);
    }
    return { error: BAD_CODE };
  }
  await hintProfile("guest");
  await trackAccess("Guest code redeemed", {
    audience: "guest",
    returning: returning !== null,
  });
  redirect(next);
}

/** A Host signs in with their Supabase Auth account. */
export async function signIn(
  _previous: DoorState,
  form: FormData,
): Promise<DoorState> {
  return atTheDoor(() => signInHost(form));
}

async function signInHost(form: FormData): Promise<DoorState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const wrong = { error: "Wrong email or password." };
  if (!email || !password) return wrong;
  if (!env.supabasePublishableKey()) {
    console.error("[access] SUPABASE_PUBLISHABLE_KEY is not set");
    return { error: "Sign-in is not set up yet." };
  }

  const visitor = await visitorHash();
  if (await tooManyAttempts(visitor, "sign_in")) return { error: WAIT };

  const client = authClient(requestCookies());
  const { error } = await client.auth.signInWithPassword({ email, password });
  // An account that is not a Host is told the same thing as a wrong password.
  const host = error ? null : await hostOf(client);
  await recordAttempt(visitor, "sign_in", host !== null);
  if (!host) {
    if (!error) await client.auth.signOut({ scope: "local" });
    return wrong;
  }
  await hintProfile("host");
  await trackAccess("Host signed in", { audience: "host" });
  redirect(PROFILE_PATH);
}

/** Ends this browser's session, Host or Guest. */
export async function signOut() {
  if (env.supabasePublishableKey()) {
    await authClient(requestCookies()).auth.signOut({ scope: "local" });
  }
  await hintProfile(null);
  redirect(ACCESS_PATH);
}

export type SettingsState = { error: string } | { saved: string } | null;

/** A Host changes the name shown on their profile. */
export async function updateProfile(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  await requireHost();
  const name = parseDisplayName(form.get("name"));
  if (name === null) {
    return { error: `Use at most ${LIMITS.nameLength} characters.` };
  }
  const { error } = await authClient(requestCookies()).auth.updateUser({
    data: { display_name: name },
  });
  if (error) {
    console.error("[access] could not update the profile", error);
    return { error: "The profile could not be saved. Try again." };
  }
  refresh();
  return { saved: "Profile saved." };
}

/** A Host changes their password, proving the current one first. */
export async function changePassword(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const host = await requireHost();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const problem = passwordProblem({
    current,
    next,
    confirm: String(form.get("confirm") ?? ""),
  });
  if (problem) return { error: problem };

  // A stolen session must not be enough to take the account over.
  const visitor = await visitorHash();
  if (await tooManyAttempts(visitor, "sign_in")) return { error: WAIT };
  const { error: wrong } =
    await sessionlessAuthClient().auth.signInWithPassword({
      email: host.email,
      password: current,
    });
  await recordAttempt(visitor, "sign_in", !wrong);
  if (wrong) return { error: "The current password is wrong." };

  const { error } = await authClient(requestCookies()).auth.updateUser({
    password: next,
  });
  if (error) {
    console.error("[access] could not change the password", error);
    return {
      error:
        error.code === "weak_password"
          ? "That password is too weak. Choose a stronger one."
          : "The password could not be changed. Try again.",
    };
  }
  return { saved: "Password changed." };
}

export type IssueState =
  | { error: string }
  | {
      /** Shown once: only its hash is stored. */
      code: string;
      label: string;
      expiresAt: string;
      devices: number;
    }
  | null;

/** A Host issues a Guest pass and gets its Guest code to hand over. */
export async function issueGuestPass(
  _previous: IssueState,
  form: FormData,
): Promise<IssueState> {
  const host = await requireHost();
  const request = parseGuestPassRequest({
    label: form.get("label"),
    hours: form.get("hours"),
    devices: form.get("devices"),
  });
  if (!request)
    return { error: "Give the pass a name, a duration and devices." };
  if ((await countLivePasses()) >= LIMITS.maxLivePasses) {
    return {
      error: `There are already ${LIMITS.maxLivePasses} live Guest passes. Revoke one first.`,
    };
  }
  const code = guestCodeFrom(randomBytes(CODE_LENGTH));
  const pass = await insertGuestPass({
    label: request.label,
    codeHash: hashCode(normalizeGuestCode(code) ?? ""),
    createdBy: host.userId,
    expiresAt: new Date(Date.now() + request.hours * 3_600_000),
    maxDevices: request.devices,
  });
  refresh();
  return {
    code,
    label: pass.label,
    expiresAt: pass.expires_at,
    devices: pass.max_devices,
  };
}

/**
 * What a Host's action on one issued pass answers, for its confirm dialog:
 * what went wrong, or what changed (and a new Guest code, shown once).
 */
export type PassActionState =
  | { error: string }
  | { done: string; expiresAt?: string; code?: string }
  | null;

const GONE: PassActionState = {
  error: "That pass is gone. Reload the page to see the current list.",
};

/** The pass a Host's form names, if it exists. */
async function passFrom(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return null;
  return guestPassById(id);
}

function statusOf(pass: {
  expires_at: string;
  revoked_at: string | null;
  deleted_at: string | null;
}) {
  return guestPassStatus({
    expiresAt: pass.expires_at,
    revokedAt: pass.revoked_at,
    deletedAt: pass.deleted_at,
  });
}

const FULL = {
  error: `There are already ${LIMITS.maxLivePasses} live Guest passes. Revoke one first.`,
};

/** A Host ends a Guest pass now: every Guest on it loses Access at once. */
export async function revokeGuestPass(
  _previous: PassActionState,
  form: FormData,
): Promise<PassActionState> {
  await requireHost();
  const pass = await passFrom(form);
  if (!pass || statusOf(pass) !== "live") return GONE;
  await revokePass(pass.id);
  refresh();
  return { done: "Revoked. Its guests lost access just now." };
}

/**
 * A Host extends a live pass, or renews one that ended (expired or revoked).
 * Its Guests come back to everything they saved: the data belongs to the pass.
 */
export async function extendGuestPass(
  _previous: PassActionState,
  form: FormData,
): Promise<PassActionState> {
  await requireHost();
  const hours = parseDuration(form.get("hours"));
  if (hours === null) return { error: "Choose how long to add." };
  const pass = await passFrom(form);
  if (!pass || pass.deleted_at) return GONE;
  const live = statusOf(pass) === "live";
  // Renewing brings a pass back into the live count, so it must have room.
  if (!live && (await countLivePasses()) >= LIMITS.maxLivePasses) return FULL;
  const now = new Date();
  const expiresAt = extendedExpiry(
    { expiresAt: pass.expires_at },
    hours,
    now.getTime(),
  );
  await extendPass(pass.id, expiresAt, now);
  refresh();
  return {
    done: live ? "Extended." : "Renewed. Its guests can come back in.",
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * A Host replaces a pass's Guest code, when it was lost or handed to the
 * wrong person. Devices on the old code are signed out; whoever enters the new
 * one gets the same saved data.
 */
export async function regenerateGuestCode(
  _previous: PassActionState,
  form: FormData,
): Promise<PassActionState> {
  await requireHost();
  const pass = await passFrom(form);
  if (!pass || pass.deleted_at) return GONE;
  const code = guestCodeFrom(randomBytes(CODE_LENGTH));
  await replaceGuestCode(pass.id, hashCode(normalizeGuestCode(code) ?? ""));
  refresh();
  return { done: "New code made. The old one no longer works.", code };
}

/**
 * A Host deletes a pass: its Guests lose Access at once, and the pass and
 * everything they saved are purged after LIMITS.retentionDays. Until then the
 * Host can restore it.
 */
export async function deleteGuestPass(
  _previous: PassActionState,
  form: FormData,
): Promise<PassActionState> {
  await requireHost();
  const pass = await passFrom(form);
  if (!pass || pass.deleted_at) return GONE;
  await markGuestPassDeleted(pass.id);
  refresh();
  return { done: "Deleted. You can restore it from the Deleted list." };
}

/** A Host takes back a deleted pass before it is purged. */
export async function restoreGuestPass(
  _previous: PassActionState,
  form: FormData,
): Promise<PassActionState> {
  await requireHost();
  const pass = await passFrom(form);
  if (!pass?.deleted_at) return GONE;
  // A pass deleted while live comes back live, so it must have room too.
  const live = statusOf({ ...pass, deleted_at: null }) === "live";
  if (live && (await countLivePasses()) >= LIMITS.maxLivePasses) return FULL;
  await restorePass(pass.id);
  refresh();
  return { done: "Restored, with everything its guests saved." };
}
