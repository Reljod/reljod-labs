// The Runner's token format. The app signs, the Runner verifies; copy this file
// (or the five steps below) to the app side unchanged.
//
//   1. payload = UTF-8 bytes of JSON {"sid":"<session uuid>","exp":<unix seconds>,"act":"<action>","own":"<owner tag>"}
//      (`own` last; `sid` is "" for the `status` action, which names no Session)
//   2. mac     = HMAC-SHA256(key = UTF-8 bytes of the secret, message = payload)
//   3. token   = base64url(payload) + "." + base64url(mac)      (base64url without "=" padding)
//   4. send it as  Authorization: Bearer <token>
//   5. one token is good for one action on one session until `exp` (at most 300 s ahead)
//
// `own` is an opaque tag of the Owner (the app derives it with HMAC, so the
// Runner never sees who the Owner is). The Runner uses it only to cap live
// Sandboxes per Owner; `write` and `run`, which can start one, require it.
//
// The MAC covers the payload bytes exactly as sent, so key order and spacing
// in the JSON do not matter to the verifier.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Every action a token can name. One route accepts exactly one of them. */
export const ACTIONS = Object.freeze([
  "write",
  "read",
  "list",
  "run",
  "destroy",
  "status",
]);

/** The shape of an Owner tag: base64url, 16 to 64 characters. */
export const OWNER_TAG = /^[A-Za-z0-9_-]{16,64}$/;

/** A token whose `exp` is further ahead than this is refused. */
export const MAX_TTL_SECONDS = 300;

const PART = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 1024;

/**
 * Sign a token.
 * @param {{ sid: string, exp: number, act: string, own?: string }} payload `exp` in unix seconds
 * @param {string} secret the shared secret (RUNNER_SECRET on the Runner)
 * @returns {string}
 */
export function sign(payload, secret) {
  const claims = { sid: payload.sid, exp: payload.exp, act: payload.act };
  if (payload.own !== undefined) claims.own = payload.own;
  const body = Buffer.from(JSON.stringify(claims), "utf8");
  const mac = createHmac("sha256", secret).update(body).digest();
  return `${body.toString("base64url")}.${mac.toString("base64url")}`;
}

/**
 * Verify a token for one session and one action.
 * @param {unknown} token
 * @param {string} secret
 * @param {{ sid: string, act: string, now?: number, requireOwner?: boolean }} expected `now` in unix seconds
 * @returns {{ ok: true, payload: { sid: string, exp: number, act: string, own: string | null } }
 *   | { ok: false, reason: "malformed" | "bad_signature" | "expired" | "too_far_ahead" | "wrong_session" | "wrong_action" | "no_owner" }}
 */
export function verify(token, secret, expected) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !PART.test(parts[0]) || !PART.test(parts[1])) {
    return { ok: false, reason: "malformed" };
  }
  const body = Buffer.from(parts[0], "base64url");
  const given = Buffer.from(parts[1], "base64url");
  const wanted = createHmac("sha256", secret).update(body).digest();
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Only a payload the secret holder signed is parsed.
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    typeof payload.sid !== "string" ||
    typeof payload.act !== "string" ||
    !Number.isSafeInteger(payload.exp) ||
    (payload.own !== undefined &&
      (typeof payload.own !== "string" || !OWNER_TAG.test(payload.own)))
  ) {
    return { ok: false, reason: "malformed" };
  }

  const now = expected.now ?? Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return { ok: false, reason: "expired" };
  if (payload.exp > now + MAX_TTL_SECONDS)
    return { ok: false, reason: "too_far_ahead" };
  if (payload.sid !== expected.sid)
    return { ok: false, reason: "wrong_session" };
  if (payload.act !== expected.act)
    return { ok: false, reason: "wrong_action" };
  const own = payload.own ?? null;
  if (expected.requireOwner && own === null)
    return { ok: false, reason: "no_owner" };
  return {
    ok: true,
    payload: { sid: payload.sid, exp: payload.exp, act: payload.act, own },
  };
}
