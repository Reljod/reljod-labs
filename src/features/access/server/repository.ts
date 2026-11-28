import "server-only";
import { LIMITS } from "../domain/guest-pass";
import { pgCode, sql, UNDEFINED_FUNCTION } from "./db";
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

const PASS_COLUMNS = [
  "id",
  "label",
  "created_at",
  "expires_at",
  "max_devices",
  "revoked_at",
  "renewed_at",
  "deleted_at",
] as const;

/** Runs a query, and names what failed when it does. */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${what}: ${message}`, { cause: error });
  }
}

/**
 * The Guest pass an anonymous Auth user is on, whatever state it is in. One
 * query (the pass joined through `guest_sessions.guest_pass_id`): the proxy
 * and every demo entry point ask this on every request.
 */
export async function guestPassOf(
  userId: string,
): Promise<GuestPassRow | null> {
  const db = sql();
  const [pass] = await attempt(
    "Could not load the Guest pass",
    () => db<GuestPassRow[]>`
      select ${db(PASS_COLUMNS.map((column) => `p.${column}`))}
      from access.guest_sessions s
      join access.guest_passes p on p.id = s.guest_pass_id
      where s.user_id = ${userId}::uuid
      limit 1`,
  );
  return pass ?? null;
}

/**
 * Whether a code would be accepted right now. Only a first look, so that a
 * wrong code never creates an Auth user; `redeem` decides under a lock.
 * Mirrors the checks in `access.redeem_guest_pass`: change them together.
 */
export async function codeLooksGood(codeHash: string, userId: string | null) {
  const db = sql();
  // One round trip: the pass by its code (unique), with the other devices on it.
  const [pass] = await attempt(
    "Could not look up the Guest code",
    () => db<
      {
        expires_at: string;
        max_devices: number;
        revoked_at: string | null;
        deleted_at: string | null;
        others: number;
      }[]
    >`
      select p.expires_at, p.max_devices, p.revoked_at, p.deleted_at,
        (select count(*)::int from access.guest_sessions s
          where s.guest_pass_id = p.id
            ${userId ? db`and s.user_id <> ${userId}::uuid` : db``}) as others
      from access.guest_passes p
      where p.code_hash = ${codeHash}`,
  );
  if (
    !pass ||
    pass.deleted_at ||
    pass.revoked_at ||
    Date.parse(pass.expires_at) <= Date.now()
  )
    return false;
  return (pass.others ?? 0) < pass.max_devices;
}

/** Binds an Auth user to the pass the code names. Null when it is refused. */
export async function redeem(input: {
  codeHash: string;
  userId: string;
  visitorHash: string;
}) {
  const [row] = await attempt(
    "Could not redeem the Guest code",
    () => sql()<{ pass_id: string; pass_expires_at: string }[]>`
      select pass_id, pass_expires_at from access.redeem_guest_pass(
        p_code_hash => ${input.codeHash}::text,
        p_user_id => ${input.userId}::uuid,
        p_visitor_hash => ${input.visitorHash}::text
      )`,
  );
  return row ? { passId: row.pass_id, expiresAt: row.pass_expires_at } : null;
}

/** Removes an anonymous Auth user that ended up with no Guest pass. */
export async function deleteGuest(userId: string) {
  const { error } = await supabase().auth.admin.deleteUser(userId);
  if (error) console.error("[access] could not delete a spent Guest", error);
}

export async function countLivePasses() {
  const [row] = await attempt(
    "Could not count Guest passes",
    () => sql()<{ count: number }[]>`
      select count(*)::int as count from access.guest_passes
      where revoked_at is null and deleted_at is null and expires_at > now()`,
  );
  return row?.count ?? 0;
}

export async function insertGuestPass(input: {
  label: string;
  codeHash: string;
  createdBy: string;
  expiresAt: Date;
  maxDevices: number;
}) {
  const db = sql();
  const [pass] = await attempt(
    "Could not create the Guest pass",
    () => db<GuestPassRow[]>`
      insert into access.guest_passes
        (label, code_hash, created_by, expires_at, max_devices)
      values (
        ${input.label}, ${input.codeHash}, ${input.createdBy},
        ${input.expiresAt.toISOString()}::timestamptz, ${input.maxDevices}
      )
      returning ${db(PASS_COLUMNS)}`,
  );
  if (!pass) throw new Error("Could not create the Guest pass: no row");
  return pass;
}

/** The newest Guest passes, each with how many browsers redeemed it. */
export async function listGuestPasses() {
  const db = sql();
  return attempt(
    "Could not list Guest passes",
    () => db<(GuestPassRow & { devices: number })[]>`
      select ${db(PASS_COLUMNS.map((column) => `p.${column}`))},
        (select count(*)::int from access.guest_sessions s
          where s.guest_pass_id = p.id) as devices
      from access.guest_passes p
      order by p.created_at desc
      limit 100`,
  );
}

export async function revokeGuestPass(id: string) {
  await attempt(
    "Could not revoke the Guest pass",
    () => sql()`
      update access.guest_passes set revoked_at = now()
      where id = ${id}::uuid and revoked_at is null`,
  );
}

/** The pass, if it is one of the Host's to manage. */
export async function guestPassById(id: string): Promise<GuestPassRow | null> {
  const db = sql();
  const [pass] = await attempt(
    "Could not load the Guest pass",
    () => db<GuestPassRow[]>`
      select ${db(PASS_COLUMNS)} from access.guest_passes
      where id = ${id}::uuid`,
  );
  return pass ?? null;
}

/**
 * Moves a pass's end and lifts a revoke, so an ended pass works again. Its
 * Guests' data was kept under the pass, so it is all still there.
 */
export async function extendGuestPass(id: string, expiresAt: Date, now: Date) {
  await attempt(
    "Could not extend the Guest pass",
    () => sql()`
      update access.guest_passes
      set expires_at = ${expiresAt.toISOString()}::timestamptz,
        renewed_at = ${now.toISOString()}::timestamptz,
        revoked_at = null
      where id = ${id}::uuid and deleted_at is null`,
  );
}

/**
 * Gives a pass a new Guest code. Every device on the old code is signed out
 * (its Guest session ends; the anonymous user is cleaned up by cron), so the
 * pass's devices are free again. The data stays with the pass. Both writes
 * are one transaction: an old device is never left on a pass whose code
 * changed under it.
 */
export async function replaceGuestCode(id: string, codeHash: string) {
  await attempt("Could not replace the Guest code", () =>
    sql().begin(async (tx) => {
      await tx`
        update access.guest_passes set code_hash = ${codeHash}
        where id = ${id}::uuid and deleted_at is null`;
      await tx`
        delete from access.guest_sessions where guest_pass_id = ${id}::uuid`;
    }),
  );
}

/** Marks a pass deleted. It and its Guests' data are purged 30 days later. */
export async function markGuestPassDeleted(id: string) {
  await attempt(
    "Could not delete the Guest pass",
    () => sql()`
      update access.guest_passes set deleted_at = now()
      where id = ${id}::uuid and deleted_at is null`,
  );
}

/** Takes a deleted pass back before it is purged, as it was when deleted. */
export async function restoreGuestPass(id: string) {
  await attempt(
    "Could not restore the Guest pass",
    () => sql()`
      update access.guest_passes set deleted_at = null
      where id = ${id}::uuid`,
  );
}

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
  let rows: { id: number | null }[];
  try {
    rows = await sql()<{ id: number | null }[]>`
      select access.take_attempt(
        p_visitor_hash => ${visitorHash}::text,
        p_kind => ${kind}::text,
        p_window_minutes => ${LIMITS.attemptWindowMinutes}::integer,
        p_max_failed => ${LIMITS.failedAttempts}::integer,
        p_global_max_failed => ${kind === "code" ? LIMITS.globalFailedCodeAttempts : null}::integer
      ) as id`;
  } catch (error) {
    if (pgCode(error) === UNDEFINED_FUNCTION) {
      // The migration that adds it is not applied yet: count, then insert.
      console.warn(
        "[access] access.take_attempt is missing; counting unlocked",
      );
      if (await tooManyAttempts(visitorHash, kind)) return null;
      return insertFailedAttempt(visitorHash, kind);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not take the attempt: ${message}`, { cause: error });
  }
  const id = rows[0]?.id;
  return id === null || id === undefined ? null : Number(id);
}

async function insertFailedAttempt(visitorHash: string, kind: AttemptKind) {
  const [row] = await attempt(
    "Could not record the attempt",
    () => sql()<{ id: number }[]>`
      insert into access.attempts (visitor_hash, kind, succeeded)
      values (${visitorHash}, ${kind}, false)
      returning id`,
  );
  if (!row) throw new Error("Could not record the attempt: no row");
  return Number(row.id);
}

/** The try worked: it no longer counts against anyone. */
export async function settleAttempt(id: number) {
  await attempt(
    "Could not record the attempt",
    () => sql()`
      update access.attempts set succeeded = true where id = ${id}`,
  );
}

/**
 * The try never reached a guess (the door is not set up, or Auth is down),
 * so it is not counted at all.
 */
export async function releaseAttempt(id: number) {
  try {
    await sql()`delete from access.attempts where id = ${id}`;
  } catch (error) {
    console.error("[access] could not release an attempt", error);
  }
}

/** Ends this anonymous user's Guest session, so its device is free again. */
export async function endGuestSession(userId: string) {
  await attempt(
    "Could not end the Guest session",
    () => sql()`
      delete from access.guest_sessions where user_id = ${userId}::uuid`,
  );
}

/** The unlocked fallback: whether this visitor (or everyone) was wrong too often. */
async function tooManyAttempts(visitorHash: string, kind: AttemptKind) {
  const since = new Date(
    Date.now() - LIMITS.attemptWindowMinutes * 60_000,
  ).toISOString();
  const db = sql();
  const [counts] = await attempt(
    "Could not count attempts",
    () => db<{ mine: number; everyone: number }[]>`
      select
        count(*) filter (where visitor_hash = ${visitorHash})::int as mine,
        count(*)::int as everyone
      from access.attempts
      where kind = ${kind} and succeeded = false
        and created_at >= ${since}::timestamptz`,
  );
  if ((counts?.mine ?? 0) >= LIMITS.failedAttempts) return true;
  if (kind !== "code") return false;
  return (counts?.everyone ?? 0) >= LIMITS.globalFailedCodeAttempts;
}
