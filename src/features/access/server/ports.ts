import type { Audience } from "../domain/audience";
import type { Owner } from "../domain/owner";
import type { Access } from "./gate";
import type { AttemptKind, GuestPassRow } from "./repository";

/**
 * What the Access services need from the outside world. The container
 * (`container.ts`) wires the real adapters (Postgres, Supabase Auth, Web
 * Analytics); tests hand in fakes.
 */

export type HostAccess = Extract<Access, { kind: "host" }>;

/**
 * This browser's Supabase Auth session and profile hint, for one request.
 * Built from the request's cookies by the route (`browser.ts`), so a service
 * never reads a cookie itself.
 */
export interface Browser {
  /** The verified session's user, or null with no session. */
  claims(): Promise<{ userId: string; anonymous: boolean } | null>;
  /** Makes this browser an anonymous Auth user; its id, or null when Auth refused. */
  signInAnonymously(): Promise<string | null>;
  /** True when Auth accepted the email and password (the session is now theirs). */
  signInWithPassword(email: string, password: string): Promise<boolean>;
  /** The signed-in account, if it is a Host (asks the Auth server). */
  host(): Promise<HostAccess | null>;
  /** Ends this browser's session only. */
  signOut(): Promise<void>;
  /** False when Auth refused the change. */
  setDisplayName(name: string): Promise<boolean>;
  setPassword(password: string): Promise<"changed" | "weak" | "failed">;
  /**
   * Sets the `labs_profile` hint cookie (or clears it, with null): it tells
   * the header's profile menu there is someone to show, and Web Analytics
   * the Audience. It carries no authority.
   */
  hint(audience: Exclude<Audience, "visitor"> | null): Promise<void>;
}

/** Tries at the door and the Guest sessions they make (`access.attempts`, `access.guest_sessions`). */
export interface DoorRepository {
  /** Records a failed try under the lock, or null when this visitor (or, for codes, everyone) is over the cap. */
  takeAttempt(visitorHash: string, kind: AttemptKind): Promise<number | null>;
  /** The try worked: it no longer counts. */
  settleAttempt(id: number): Promise<void>;
  /** The try never reached a guess: it is not counted at all. */
  releaseAttempt(id: number): Promise<void>;
  /** A first look, so a wrong code creates no Auth user; `redeem` decides under a lock. */
  codeLooksGood(codeHash: string, userId: string | null): Promise<boolean>;
  redeem(input: {
    codeHash: string;
    userId: string;
    visitorHash: string;
  }): Promise<{ passId: string; expiresAt: string } | null>;
  /** Removes an anonymous Auth user that ended up on no pass. */
  deleteGuest(userId: string): Promise<void>;
  /** Frees the device of a Guest who left. */
  endGuestSession(userId: string): Promise<void>;
}

export type ListedPass = GuestPassRow & { devices: number };

/** The Guest passes a Host manages (`access.guest_passes`). */
export interface GuestPassRepository {
  countLive(): Promise<number>;
  list(): Promise<ListedPass[]>;
  byId(id: string): Promise<GuestPassRow | null>;
  insert(input: {
    label: string;
    codeHash: string;
    createdBy: string;
    expiresAt: Date;
    maxDevices: number;
  }): Promise<GuestPassRow>;
  revoke(id: string): Promise<void>;
  extend(id: string, expiresAt: Date, now: Date): Promise<void>;
  /** A new code hash; every device on the old code is signed out in the same transaction. */
  replaceCode(id: string, codeHash: string): Promise<void>;
  markDeleted(id: string): Promise<void>;
  restore(id: string): Promise<void>;
}

/** Checks a password without touching this browser's session. */
export interface Passwords {
  verify(email: string, password: string): Promise<boolean>;
}

/** Web Analytics custom events. Best effort; never an email, a name or a label. */
export interface Analytics {
  track(
    event: "Host signed in" | "Guest code redeemed",
    properties: { audience: Exclude<Audience, "visitor">; returning?: boolean },
  ): Promise<void>;
}

/** The Owner's MCP token epoch (`access.token_epochs`). */
export interface McpTokens {
  disconnectAll(owner: Owner): Promise<void>;
}

export type AccessPorts = {
  door: DoorRepository;
  passes: GuestPassRepository;
  passwords: Passwords;
  analytics: Analytics;
  tokens: McpTokens;
  /** Supabase Auth is set up (its publishable key is there); without it nobody can sign in. */
  authReady: () => boolean;
  /** A fresh Guest code, from a secure random source. */
  newGuestCode: () => string;
  now: () => Date;
};
