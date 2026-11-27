import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import { defaultStaff, type Staff } from "../../domain/staff";
import { isUuid } from "../db";
import type { AuditLog, WorkspaceRepository } from "../ports";

const STAFF_TTL_MS = 60_000;
const STAFF_KEPT = 500;

/** Who the visitor is in their Workspace, and everyone they may switch to. */
export type Signed = { staff: Staff; everyone: Staff[] };

/**
 * The Staff gate (ADR 0014). `resolve` seeds the Owner's Workspace on first
 * use and picks the Staff member the visitor is signed in as: the one the
 * `harness_staff` cookie remembers, only if it is the Owner's own, else the
 * first `user`. A Role is not a security boundary between visitors (anyone
 * in a Workspace may switch); Access and the Owner are.
 */
export interface StaffService {
  resolve(owner: Owner, remembered: string | undefined): Promise<Signed>;
  /** Signs the visitor in as another of the Owner's Staff and records `staff.switched`. */
  switchTo(owner: Owner, signed: Signed, staffId: string): Promise<Staff>;
  /** One of the Owner's Staff, or null (a token's or a form's id is never trusted until here). */
  owned(owner: Owner, staffId: unknown): Promise<Staff | null>;
}

export function createStaffService(ports: {
  workspace: WorkspaceRepository;
  audit: AuditLog;
  /** Called when a Workspace was seeded just now (its Passages wait for embeddings). */
  seeded: (owner: Owner) => void;
  now?: () => number;
}): StaffService {
  const { workspace } = ports;
  const now = ports.now ?? Date.now;

  const ensure = async (owner: Owner) => {
    if (await workspace.ensure(owner)) {
      kept.delete(owner);
      ports.seeded(owner);
    }
  };

  /**
   * A Workspace's Staff are written once, by its seed, and never edited, so
   * an instance keeps each Owner's list for `STAFF_TTL_MS`. Every Harness
   * request runs this gate; with the list kept, a read is one database
   * round (its own query) instead of two. Bounded, and dropped whenever the
   * Workspace is seeded again.
   */
  const kept = new Map<Owner, { staff: Staff[]; until: number }>();

  /**
   * The seed check and the Staff read start together: on a Workspace already
   * seeded (every visit after the first) that is one database round.
   */
  async function workspaceStaff(owner: Owner): Promise<Staff[]> {
    const hit = kept.get(owner);
    if (hit && hit.until > now()) return hit.staff;
    const staff = await readStaff(owner);
    if (kept.size >= STAFF_KEPT) kept.delete(kept.keys().next().value as Owner);
    kept.set(owner, { staff, until: now() + STAFF_TTL_MS });
    return staff;
  }

  async function readStaff(owner: Owner): Promise<Staff[]> {
    const [, staff] = await Promise.all([
      ensure(owner),
      workspace.staff(owner),
    ]);
    if (staff.length > 0) return staff;
    // A new Workspace (the read raced its seed), or one remembered as
    // seeded but purged since: seed it again if need be, then read again.
    workspace.forget(owner);
    await ensure(owner);
    return workspace.staff(owner);
  }

  return {
    async resolve(owner, remembered) {
      const everyone = await workspaceStaff(owner);
      const staff =
        (isUuid(remembered)
          ? everyone.find((member) => member.id === remembered)
          : undefined) ?? defaultStaff(everyone);
      if (!staff) throw new Error("The Workspace has no Staff");
      return { staff, everyone };
    },

    async switchTo(owner, signed, staffId) {
      const to = isUuid(staffId)
        ? signed.everyone.find((member) => member.id === staffId)
        : undefined;
      if (!to)
        throw new NotFoundError("That Staff member is not in this Workspace.");
      const from = signed.staff;
      if (to.id !== from.id) {
        await ports.audit.record({
          owner,
          actor: { kind: "staff", staff: to },
          action: "staff.switched",
          summary: `Signed in as ${to.name} (${to.role}), was ${from.name}`,
          target: { kind: "staff", id: to.id },
          detail: {
            from: { id: from.id, name: from.name, role: from.role },
            to: { id: to.id, name: to.name, role: to.role },
          },
        });
      }
      return to;
    },

    owned: (owner, staffId) => workspace.ownedStaff(owner, staffId),
  };
}
