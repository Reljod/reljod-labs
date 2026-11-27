import "server-only";
import { LIMITS } from "../domain/guest-pass";
import { supabase } from "./supabase";

export type AttemptKind = "code" | "sign_in";

export type GuestPassRow = {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  max_devices: number;
  revoked_at: string | null;
  renewed_at: string | null;
  deleted_at: string | null;
};

const PASS_COLUMNS =
  "id, label, created_at, expires_at, max_devices, revoked_at, renewed_at, deleted_at";

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/**
 * The Guest pass an anonymous Auth user is on, whatever state it is in. One
 * request (the pass embedded through `guest_sessions.guest_pass_id`): the
 * proxy and every demo entry point ask this on every request.
 */
export async function guestPassOf(
  userId: string,
): Promise<GuestPassRow | null> {
  const { data: session, error } = await supabase()
    .from("guest_sessions")
    .select(`guest_passes(${PASS_COLUMNS})`)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Could not load the Guest pass", error);
  // A many-to-one embed is one row or null; untyped, the client calls it an array.
  const pass = (session as { guest_passes: unknown } | null)?.guest_passes;
  return (
    Array.isArray(pass) ? (pass[0] ?? null) : (pass ?? null)
  ) as GuestPassRow | null;
}

/**
 * Whether a code would be accepted right now. Only a first look, so that a
 * wrong code never creates an Auth user; `redeem` decides under a lock.
 * Mirrors the checks in `access.redeem_guest_pass`: change them together.
 */
export async function codeLooksGood(codeHash: string, userId: string | null) {
  const { data: pass, error } = await supabase()
    .from("guest_passes")
    .select("id, expires_at, max_devices, revoked_at, deleted_at")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (error) fail("Could not look up the Guest code", error);
  if (
    !pass ||
    pass.deleted_at ||
    pass.revoked_at ||
    Date.parse(pass.expires_at) <= Date.now()
  )
    return false;
  const { data: sessions, error: sessionError } = await supabase()
    .from("guest_sessions")
    .select("user_id")
    .eq("guest_pass_id", pass.id);
  if (sessionError) fail("Could not count the Guest sessions", sessionError);
  const others = sessions.filter((session) => session.user_id !== userId);
  return others.length < pass.max_devices;
}

/** Binds an Auth user to the pass the code names. Null when it is refused. */
export async function redeem(input: {
  codeHash: string;
  userId: string;
  visitorHash: string;
}) {
  const { data, error } = await supabase().rpc("redeem_guest_pass", {
    p_code_hash: input.codeHash,
    p_user_id: input.userId,
    p_visitor_hash: input.visitorHash,
  });
  if (error) fail("Could not redeem the Guest code", error);
  const [row] = (data ?? []) as { pass_id: string; pass_expires_at: string }[];
  return row ? { passId: row.pass_id, expiresAt: row.pass_expires_at } : null;
}

/** Removes an anonymous Auth user that ended up with no Guest pass. */
export async function deleteGuest(userId: string) {
  const { error } = await supabase().auth.admin.deleteUser(userId);
  if (error) console.error("[access] could not delete a spent Guest", error);
}

export async function countLivePasses() {
  const { count, error } = await supabase()
    .from("guest_passes")
    .select("id", { count: "exact", head: true })
    .is("revoked_at", null)
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error) fail("Could not count Guest passes", error);
  return count ?? 0;
}

export async function insertGuestPass(input: {
  label: string;
  codeHash: string;
  createdBy: string;
  expiresAt: Date;
  maxDevices: number;
}) {
  const { data, error } = await supabase()
    .from("guest_passes")
    .insert({
      label: input.label,
      code_hash: input.codeHash,
      created_by: input.createdBy,
      expires_at: input.expiresAt.toISOString(),
      max_devices: input.maxDevices,
    })
    .select(PASS_COLUMNS)
    .single();
  if (error) fail("Could not create the Guest pass", error);
  return data as GuestPassRow;
}

/** The newest Guest passes, each with how many browsers redeemed it. */
export async function listGuestPasses() {
  const { data, error } = await supabase()
    .from("guest_passes")
    .select(PASS_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("Could not list Guest passes", error);
  const passes = data as GuestPassRow[];
  if (passes.length === 0) return [];
  const { data: sessions, error: sessionError } = await supabase()
    .from("guest_sessions")
    .select("guest_pass_id")
    .in(
      "guest_pass_id",
      passes.map((pass) => pass.id),
    );
  if (sessionError) fail("Could not count the Guest sessions", sessionError);
  const devices = new Map<string, number>();
  for (const session of sessions) {
    devices.set(
      session.guest_pass_id,
      (devices.get(session.guest_pass_id) ?? 0) + 1,
    );
  }
  return passes.map((pass) => ({
    ...pass,
    devices: devices.get(pass.id) ?? 0,
  }));
}

export async function revokeGuestPass(id: string) {
  const { error } = await supabase()
    .from("guest_passes")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) fail("Could not revoke the Guest pass", error);
}

/** The pass, if it is one of the Host's to manage. */
export async function guestPassById(id: string): Promise<GuestPassRow | null> {
  const { data, error } = await supabase()
    .from("guest_passes")
    .select(PASS_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("Could not load the Guest pass", error);
  return data as GuestPassRow | null;
}

/**
 * Moves a pass's end and lifts a revoke, so an ended pass works again. Its
 * Guests' data was kept under the pass, so it is all still there.
 */
export async function extendGuestPass(id: string, expiresAt: Date, now: Date) {
  const { error } = await supabase()
    .from("guest_passes")
    .update({
      expires_at: expiresAt.toISOString(),
      renewed_at: now.toISOString(),
      revoked_at: null,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) fail("Could not extend the Guest pass", error);
}

/**
 * Gives a pass a new Guest code. Every device on the old code is signed out
 * (its Guest session ends; the anonymous user is cleaned up by cron), so the
 * pass's devices are free again. The data stays with the pass.
 */
export async function replaceGuestCode(id: string, codeHash: string) {
  const { error } = await supabase()
    .from("guest_passes")
    .update({ code_hash: codeHash })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) fail("Could not replace the Guest code", error);
  const { error: sessionError } = await supabase()
    .from("guest_sessions")
    .delete()
    .eq("guest_pass_id", id);
  if (sessionError) fail("Could not end the old Guest sessions", sessionError);
}

/** Marks a pass deleted. It and its Guests' data are purged 30 days later. */
export async function markGuestPassDeleted(id: string) {
  const { error } = await supabase()
    .from("guest_passes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) fail("Could not delete the Guest pass", error);
}

/** Takes a deleted pass back before it is purged, as it was when deleted. */
export async function restoreGuestPass(id: string) {
  const { error } = await supabase()
    .from("guest_passes")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) fail("Could not restore the Guest pass", error);
}

/** PostgREST's answer when a function is not in its schema cache. */
const NO_SUCH_FUNCTION = "PGRST202";

/**
 * Takes one try at the door, or refuses it: null when this visitor has been
 * wrong `LIMITS.failedAttempts` times in the window, or (for Guest codes) when
 * everyone together has been wrong `LIMITS.globalFailedCodeAttempts` times.
 * The count and the insert are one step under a lock (`access.take_attempt`),
 * so a burst cannot slip past the count. The try is recorded as failed; call
 * `settleAttempt` when it succeeds. Host sign-ins carry no global cap, so a
 * flood of wrong Guest codes never locks the Host out.
 */
export async function takeAttempt(
  visitorHash: string,
  kind: AttemptKind,
): Promise<number | null> {
  const { data, error } = await supabase().rpc("take_attempt", {
    p_visitor_hash: visitorHash,
    p_kind: kind,
    p_window_minutes: LIMITS.attemptWindowMinutes,
    p_max_failed: LIMITS.failedAttempts,
    p_global_max_failed:
      kind === "code" ? LIMITS.globalFailedCodeAttempts : null,
  });
  if (error?.code === NO_SUCH_FUNCTION) {
    // The migration that adds it is not applied yet: count, then insert.
    console.warn("[access] access.take_attempt is missing; counting unlocked");
    if (await tooManyAttempts(visitorHash, kind)) return null;
    return insertFailedAttempt(visitorHash, kind);
  }
  if (error) fail("Could not take the attempt", error);
  return data === null || data === undefined ? null : Number(data);
}

async function insertFailedAttempt(visitorHash: string, kind: AttemptKind) {
  const { data, error } = await supabase()
    .from("attempts")
    .insert({ visitor_hash: visitorHash, kind, succeeded: false })
    .select("id")
    .single();
  if (error) fail("Could not record the attempt", error);
  return Number((data as { id: number | string }).id);
}

/** The try worked: it no longer counts against anyone. */
export async function settleAttempt(id: number) {
  const { error } = await supabase()
    .from("attempts")
    .update({ succeeded: true })
    .eq("id", id);
  if (error) fail("Could not record the attempt", error);
}

/**
 * The try never reached a guess (the door is not set up, or Auth is down),
 * so it is not counted at all.
 */
export async function releaseAttempt(id: number) {
  const { error } = await supabase().from("attempts").delete().eq("id", id);
  if (error) console.error("[access] could not release an attempt", error);
}

/** Ends this anonymous user's Guest session, so its device is free again. */
export async function endGuestSession(userId: string) {
  const { error } = await supabase()
    .from("guest_sessions")
    .delete()
    .eq("user_id", userId);
  if (error) fail("Could not end the Guest session", error);
}

/** The unlocked fallback: whether this visitor (or everyone) was wrong too often. */
async function tooManyAttempts(visitorHash: string, kind: AttemptKind) {
  const since = new Date(
    Date.now() - LIMITS.attemptWindowMinutes * 60_000,
  ).toISOString();
  const { count, error } = await supabase()
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("visitor_hash", visitorHash)
    .eq("kind", kind)
    .eq("succeeded", false)
    .gte("created_at", since);
  if (error) fail("Could not count attempts", error);
  if ((count ?? 0) >= LIMITS.failedAttempts) return true;
  if (kind !== "code") return false;
  const { count: everyone, error: globalError } = await supabase()
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("succeeded", false)
    .gte("created_at", since);
  if (globalError) fail("Could not count attempts", globalError);
  return (everyone ?? 0) >= LIMITS.globalFailedCodeAttempts;
}
