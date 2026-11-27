import "server-only";
import { createHash } from "node:crypto";
import { normalizeGuestCode } from "../../domain/guest-code";
import { LIMITS } from "../../domain/guest-pass";
import { AccessDeniedError } from "../errors";
import type { Access } from "../gate";
import type { HostAccess } from "../ports";

/**
 * Only a Host. A Guest, the e2e suite and a visitor are all refused alike, as
 * if they had no Access, at every Host-only service method (the routes and
 * the proxy refuse them too, but a service is reachable from more than one
 * entry point).
 */
export function asHost(access: Access | null): HostAccess {
  if (access?.kind !== "host") throw new AccessDeniedError();
  return access;
}

/** The stored form of a Guest code: only its hash, never the code. */
export function codeHashOf(code: string): string {
  return createHash("sha256")
    .update(normalizeGuestCode(code) ?? "")
    .digest("hex");
}

/** What a visitor over the door's cap is told. */
export const WAIT = `Too many tries. Wait ${LIMITS.attemptWindowMinutes} minutes and try again.`;
