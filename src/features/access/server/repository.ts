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
};

const PASS_COLUMNS =
  "id, label, created_at, expires_at, max_devices, revoked_at";

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** The Guest pass an anonymous Auth user is on, whatever state it is in. */
export async function guestPassOf(
  userId: string,
): Promise<GuestPassRow | null> {
  const { data: session, error } = await supabase()
    .from("guest_sessions")
    .select("guest_pass_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("Could not load the Guest session", error);
  if (!session) return null;
  const { data: pass, error: passError } = await supabase()
    .from("guest_passes")
    .select(PASS_COLUMNS)
    .eq("id", session.guest_pass_id)
    .maybeSingle();
  if (passError) fail("Could not load the Guest pass", passError);
  return pass as GuestPassRow | null;
}

/**
 * Whether a code would be accepted right now. Only a first look, so that a
 * wrong code never creates an Auth user; `redeem` decides under a lock.
 */
export async function codeLooksGood(codeHash: string, userId: string | null) {
  const { data: pass, error } = await supabase()
    .from("guest_passes")
    .select("id, expires_at, max_devices, revoked_at")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (error) fail("Could not look up the Guest code", error);
  if (!pass || pass.revoked_at || Date.parse(pass.expires_at) <= Date.now())
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

export async function recordAttempt(
  visitorHash: string,
  kind: AttemptKind,
  succeeded: boolean,
) {
  const { error } = await supabase()
    .from("attempts")
    .insert({ visitor_hash: visitorHash, kind, succeeded });
  if (error) fail("Could not record the attempt", error);
}

/** Whether this visitor has been wrong too often lately to try again. */
export async function tooManyAttempts(visitorHash: string, kind: AttemptKind) {
  const since = new Date(Date.now() - LIMITS.attemptWindowMinutes * 60_000);
  const { count, error } = await supabase()
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("visitor_hash", visitorHash)
    .eq("kind", kind)
    .eq("succeeded", false)
    .gte("created_at", since.toISOString());
  if (error) fail("Could not count attempts", error);
  return (count ?? 0) >= LIMITS.failedAttempts;
}
