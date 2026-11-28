import { z } from "zod";
import { ACCESS_API, DOOR_ROUTES } from "../constants";

/**
 * The REST routes of Access and what they answer. Shared by the routes
 * (`src/app/api/access/**`) and the browser client (`components/api.ts`).
 * The door's own routes are in `constants.ts`, where the proxy reads them.
 */
export const ROUTES = {
  /** GET who this browser is; POST a Host signs in; DELETE sign out. Open to everyone. */
  session: DOOR_ROUTES.session,
  /** POST a Guest code: this browser becomes a Guest on its pass. Open to everyone. */
  guestSession: DOOR_ROUTES.guestSession,
  /** PATCH the Host's display name. */
  profile: `${ACCESS_API}/profile`,
  /** PUT the Host's new password. */
  password: `${ACCESS_API}/password`,
  /** POST issues a Guest pass. */
  guestPasses: `${ACCESS_API}/guest-passes`,
  /** DELETE soft-deletes a pass; its sub-resources change its state. */
  guestPass: (id: string) =>
    `${ACCESS_API}/guest-passes/${encodeURIComponent(id)}`,
  extend: (id: string) =>
    `${ACCESS_API}/guest-passes/${encodeURIComponent(id)}/extend`,
  code: (id: string) =>
    `${ACCESS_API}/guest-passes/${encodeURIComponent(id)}/code`,
  revoke: (id: string) =>
    `${ACCESS_API}/guest-passes/${encodeURIComponent(id)}/revoke`,
  restore: (id: string) =>
    `${ACCESS_API}/guest-passes/${encodeURIComponent(id)}/restore`,
  /** DELETE: "Disconnect all MCP clients" of the signed-in Host. */
  mcpClients: `${ACCESS_API}/mcp-clients`,
} as const;

export const signInSchema = z.object({
  email: z.string().max(320),
  password: z.string().max(1024),
  next: z.string().max(2048).nullish(),
});

export const redeemSchema = z.object({
  code: z.string().max(64),
  next: z.string().max(2048).nullish(),
});

export const profileSchema = z.object({ name: z.string().max(1024) });

export const passwordSchema = z.object({
  current: z.string().max(1024),
  next: z.string().max(1024),
  confirm: z.string().max(1024),
});

export const issueSchema = z.object({
  label: z.string().max(1024),
  hours: z.number(),
  devices: z.number(),
});

export const extendSchema = z.object({ hours: z.number() });

export const passParamsSchema = z.object({ id: z.string().max(64) });

/**
 * Where the browser goes after the door. It loads that page in full rather
 * than navigating in place: Next keeps recent pages alive (with their React
 * state and query caches), so a soft navigation after a change of account
 * would flash the previous Owner's data.
 */
export type Destination = { to: string };

/** Who this browser is, for the header's profile menu. Null for a visitor. */
export type Profile =
  | { kind: "host"; email: string; name: string }
  | { kind: "guest"; label: string; expiresAt: string }
  | null;

/** A saved setting, said back where it was saved. */
export type Saved = { saved: string };

/** A Guest pass just issued, with its Guest code: shown once, only its hash is stored. */
export type IssuedPass = {
  code: string;
  label: string;
  expiresAt: string;
  devices: number;
};

/** What a confirmed write changed, said in its dialog. */
export type Done = { done: string };

/** What changed on one pass (and a new Guest code, shown once). */
export type PassChange = Done & { expiresAt?: string; code?: string };
