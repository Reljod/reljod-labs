import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type { Role, Staff } from "../domain/staff";
import { isUuid, sql } from "./db";

type StaffRow = {
  id: string;
  key: string;
  name: string;
  title: string;
  role: Role;
  initials: string;
};

const staffOf = (row: StaffRow): Staff => ({
  id: row.id,
  key: row.key,
  name: row.name,
  title: row.title,
  role: row.role,
  initials: row.initials,
});

/** The Workspace's Staff: users first, then admins, in the order they were seeded. */
export async function listStaff(owner: Owner): Promise<Staff[]> {
  const rows = await sql()<StaffRow[]>`
    select id, key, name, title, role, initials
    from harness.staff
    where owner = ${owner}
    order by (role = 'admin'), created_at, key`;
  return rows.map(staffOf);
}

/** One of the Owner's Staff, or null: an id from a cookie, a token or a request is never trusted until it passes here. */
export async function ownedStaff(
  owner: Owner,
  staffId: unknown,
): Promise<Staff | null> {
  if (!isUuid(staffId)) return null;
  const [row] = await sql()<StaffRow[]>`
    select id, key, name, title, role, initials
    from harness.staff
    where owner = ${owner} and id = ${staffId}`;
  return row ? staffOf(row) : null;
}
