import "server-only";
import { InvalidError, LimitError, NotFoundError } from "@/platform/errors";
import type { IssuedPass, PassChange } from "../../domain/api";
import {
  extendedExpiry,
  guestPassStatus,
  LIMITS,
  parseDuration,
  parseGuestPassRequest,
} from "../../domain/guest-pass";
import type { Access } from "../gate";
import type { AccessPorts, ListedPass } from "../ports";
import type { GuestPassRow } from "../repository";
import { asHost, codeHashOf } from "./common";

const GONE = "That pass is gone. Reload the page to see the current list.";
const FULL = `There are already ${LIMITS.maxLivePasses} live Guest passes. Revoke one first.`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Host's Guest passes. Every method is the Host's alone. A pass's Guests
 * keep everything they saved through an extension, a renewal, a new code and
 * a restore: the data belongs to the pass. Nothing here hard-deletes a pass;
 * a deleted one is purged by cron after `LIMITS.retentionDays`.
 */
export interface GuestPassService {
  list(access: Access | null): Promise<ListedPass[]>;
  liveCount(access: Access | null): Promise<number>;
  issue(
    access: Access | null,
    input: { label: string; hours: number; devices: number },
  ): Promise<IssuedPass>;
  /** Extends a live pass, or renews one that ended (expired or revoked). */
  extend(access: Access | null, id: string, hours: number): Promise<PassChange>;
  /** A new Guest code; every device on the old one is signed out. */
  newCode(access: Access | null, id: string): Promise<PassChange>;
  /** Ends a live pass now: every Guest on it loses Access at once. */
  revoke(access: Access | null, id: string): Promise<PassChange>;
  /** Marks a pass deleted; restorable until it is purged. */
  remove(access: Access | null, id: string): Promise<PassChange>;
  restore(access: Access | null, id: string): Promise<PassChange>;
}

function statusOf(pass: GuestPassRow, now: number) {
  return guestPassStatus(
    {
      expiresAt: pass.expires_at,
      revokedAt: pass.revoked_at,
      deletedAt: pass.deleted_at,
    },
    now,
  );
}

export function createGuestPassService(
  ports: Pick<AccessPorts, "passes" | "newGuestCode" | "now">,
): GuestPassService {
  const { passes } = ports;

  /** The pass a Host's request names, if it exists. */
  async function passFor(id: string) {
    return UUID.test(id) ? passes.byId(id) : null;
  }

  async function assertRoom() {
    if ((await passes.countLive()) >= LIMITS.maxLivePasses)
      throw new LimitError(FULL);
  }

  return {
    async list(access) {
      asHost(access);
      return passes.list();
    },

    async liveCount(access) {
      asHost(access);
      return passes.countLive();
    },

    async issue(access, input) {
      const host = asHost(access);
      const request = parseGuestPassRequest(input);
      if (!request)
        throw new InvalidError("Give the pass a name, a duration and devices.");
      await assertRoom();
      const code = ports.newGuestCode();
      const pass = await passes.insert({
        label: request.label,
        codeHash: codeHashOf(code),
        createdBy: host.userId,
        expiresAt: new Date(ports.now().getTime() + request.hours * 3_600_000),
        maxDevices: request.devices,
      });
      return {
        code,
        label: pass.label,
        expiresAt: pass.expires_at,
        devices: pass.max_devices,
      };
    },

    async extend(access, id, input) {
      asHost(access);
      const hours = parseDuration(input);
      if (hours === null) throw new InvalidError("Choose how long to add.");
      const pass = await passFor(id);
      if (!pass || pass.deleted_at) throw new NotFoundError(GONE);
      const now = ports.now();
      const live = statusOf(pass, now.getTime()) === "live";
      // Renewing brings a pass back into the live count, so it must have room.
      if (!live) await assertRoom();
      const expiresAt = extendedExpiry(
        { expiresAt: pass.expires_at },
        hours,
        now.getTime(),
      );
      await passes.extend(pass.id, expiresAt, now);
      return {
        done: live ? "Extended." : "Renewed. Its guests can come back in.",
        expiresAt: expiresAt.toISOString(),
      };
    },

    async newCode(access, id) {
      asHost(access);
      const pass = await passFor(id);
      if (!pass || pass.deleted_at) throw new NotFoundError(GONE);
      const code = ports.newGuestCode();
      await passes.replaceCode(pass.id, codeHashOf(code));
      return { done: "New code made. The old one no longer works.", code };
    },

    async revoke(access, id) {
      asHost(access);
      const pass = await passFor(id);
      if (!pass || statusOf(pass, ports.now().getTime()) !== "live")
        throw new NotFoundError(GONE);
      await passes.revoke(pass.id);
      return { done: "Revoked. Its guests lost access just now." };
    },

    async remove(access, id) {
      asHost(access);
      const pass = await passFor(id);
      if (!pass || pass.deleted_at) throw new NotFoundError(GONE);
      await passes.markDeleted(pass.id);
      return { done: "Deleted. You can restore it from the Deleted list." };
    },

    async restore(access, id) {
      asHost(access);
      const pass = await passFor(id);
      if (!pass?.deleted_at) throw new NotFoundError(GONE);
      // A pass deleted while live comes back live, so it must have room too.
      const live =
        statusOf({ ...pass, deleted_at: null }, ports.now().getTime()) ===
        "live";
      if (live) await assertRoom();
      await passes.restore(pass.id);
      return { done: "Restored, with everything its guests saved." };
    },
  };
}
