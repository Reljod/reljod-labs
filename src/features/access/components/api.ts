"use client";

import { attempt, getJson, type Outcome, send } from "@/platform/client/api";
import {
  type Destination,
  type Done,
  type IssuedPass,
  type PassChange,
  type Profile,
  ROUTES,
  type Saved,
} from "../domain/api";

/** Typed wrappers over the Access routes; components never call `fetch` themselves. */

export function getProfile(): Promise<Profile> {
  return getJson<Profile>(ROUTES.session);
}

export function signIn(input: {
  email: string;
  password: string;
  next?: string | null;
}): Promise<Outcome<Destination>> {
  return attempt(() => send<Destination>("POST", ROUTES.session, input));
}

export function redeemGuestCode(input: {
  code: string;
  next: string;
}): Promise<Outcome<Destination>> {
  return attempt(() => send<Destination>("POST", ROUTES.guestSession, input));
}

export function signOut(): Promise<Outcome<Destination>> {
  return attempt(() => send<Destination>("DELETE", ROUTES.session));
}

export function saveProfile(name: string): Promise<Outcome<Saved>> {
  return attempt(() => send<Saved>("PATCH", ROUTES.profile, { name }));
}

export function changePassword(input: {
  current: string;
  next: string;
  confirm: string;
}): Promise<Outcome<Saved>> {
  return attempt(() => send<Saved>("PUT", ROUTES.password, input));
}

export function issueGuestPass(input: {
  label: string;
  hours: number;
  devices: number;
}): Promise<Outcome<IssuedPass>> {
  return attempt(() => send<IssuedPass>("POST", ROUTES.guestPasses, input));
}

export function extendGuestPass(
  id: string,
  hours: number,
): Promise<Outcome<PassChange>> {
  return attempt(() => send<PassChange>("POST", ROUTES.extend(id), { hours }));
}

export function regenerateGuestCode(id: string): Promise<Outcome<PassChange>> {
  return attempt(() => send<PassChange>("POST", ROUTES.code(id)));
}

export function revokeGuestPass(id: string): Promise<Outcome<PassChange>> {
  return attempt(() => send<PassChange>("POST", ROUTES.revoke(id)));
}

export function deleteGuestPass(id: string): Promise<Outcome<PassChange>> {
  return attempt(() => send<PassChange>("DELETE", ROUTES.guestPass(id)));
}

export function restoreGuestPass(id: string): Promise<Outcome<PassChange>> {
  return attempt(() => send<PassChange>("POST", ROUTES.restore(id)));
}

/** The Guest access consent page's Allow or Deny: where the browser goes next. */
export function answerMcpClient(input: {
  request: string;
  answer: "allow" | "deny";
  trustHost: string | null;
}): Promise<Outcome<Destination>> {
  return attempt(() => send<Destination>("POST", ROUTES.mcpConsent, input));
}

export function disconnectMcpClients(): Promise<Outcome<Done>> {
  return attempt(() => send<Done>("DELETE", ROUTES.mcpClients));
}
