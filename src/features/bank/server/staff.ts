import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { isUuid } from "../core/db";
import { ensureBank, forgetBank } from "../core/seed";
import type { Staff } from "../domain/staff";
import { sql } from "./db";
import type { StaffRepository } from "./ports";

function listStaff(owner: Owner): Promise<Staff[]> {
  return sql()<Staff[]>`
    select id, key, name, title, role, initials from bank.staff
    where owner = ${owner} order by created_at, key`;
}

/** The Owner's Staff in `bank.staff`, with the bank opened (and seeded) on first use. */
export const staffRepository: StaffRepository = {
  async open(owner) {
    // `ensureBank` is a no-op after the first call per instance, so the two run together.
    const [, staff] = await Promise.all([
      ensureBank(sql(), owner),
      listStaff(owner),
    ]);
    if (staff.length > 0) return staff;
    // A new bank (the read raced its seed), or one purged since: seed and read again.
    forgetBank(owner);
    await ensureBank(sql(), owner);
    return listStaff(owner);
  },

  async find(owner, staffId) {
    if (!isUuid(staffId)) return null;
    const [staff] = await sql()<Staff[]>`
      select id, key, name, title, role, initials from bank.staff
      where owner = ${owner} and id = ${staffId}`;
    return staff ?? null;
  },
};
