/**
 * The Owner of saved demo data: who a Client, a Desk, a Pre-screen run or an
 * Ask session belongs to. A Host owns their own data. A Guest's data belongs
 * to their Guest pass, so every device on the pass sees the same data, and it
 * outlives the anonymous Auth user, a new Guest code and an extension.
 * The e2e suite owns its own data apart from everyone else's.
 *
 * Stored as text in an `owner` column on each demo's top-level rows, and
 * purged with the Guest pass 30 days after the pass is deleted
 * (`access.purge_owner`, ADR 0011).
 */
export type Owner = `host:${string}` | `guest:${string}` | "e2e";

export type OwnerSource =
  | { kind: "host"; userId: string }
  | { kind: "guest"; passId: string }
  | { kind: "e2e" };

export function ownerOf(access: OwnerSource): Owner {
  switch (access.kind) {
    case "host":
      return `host:${access.userId}`;
    case "guest":
      return `guest:${access.passId}`;
    case "e2e":
      return "e2e";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An Owner read back from a token or a row, or null when it is not one. */
export function parseOwner(value: unknown): Owner | null {
  if (value === "e2e") return "e2e";
  if (typeof value !== "string") return null;
  const [kind, id, ...rest] = value.split(":");
  if (rest.length > 0 || !id || !UUID.test(id)) return null;
  return kind === "host" || kind === "guest" ? (value as Owner) : null;
}

/** The Guest pass an Owner stands for, or null for a Host or the e2e suite. */
export function guestPassIdOf(owner: Owner): string | null {
  return owner.startsWith("guest:") ? owner.slice("guest:".length) : null;
}
