import "server-only";
import { cookies } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import { type Access, requireOwner } from "@/features/access/server/gate";
import type { Actor } from "../core/actor";
import { auditIn } from "../core/audit";
import { isUuid } from "../core/db";
import { NotFoundError } from "../core/errors";
import { ensureBank, forgetBank } from "../core/seed";
import { STAFF_COOKIE } from "../domain/api";
import type { Via } from "../domain/commands";
import { defaultStaff, type Staff } from "../domain/staff";
import { sql } from "./db";
import { type Visitor, visitor } from "./rate";

/**
 * Who a request acts as: the Access that let it in, the Owner whose bank it
 * reaches, the Staff member the visitor is signed in as, and the visitor
 * hash its limits count against.
 */
export type StaffContext = {
  access: Access;
  owner: Owner;
  staff: Staff;
  everyone: Staff[];
  visitor: Visitor;
};

export async function listStaff(owner: Owner): Promise<Staff[]> {
  return sql()<Staff[]>`
    select id, key, name, title, role, initials from bank.staff
    where owner = ${owner} order by created_at, key`;
}

async function bankStaff(owner: Owner): Promise<Staff[]> {
  const [, staff] = await Promise.all([ensureBank(sql(), owner), listStaff(owner)]);
  if (staff.length > 0) return staff;
  // A new bank (the read raced its seed), or one purged since: seed and read again.
  forgetBank(owner);
  await ensureBank(sql(), owner);
  return listStaff(owner);
}

/**
 * The gate every bank entry point passes: the Access gate (`requireOwner`),
 * the Owner's bank (opened with its seed on first use), and the Staff
 * member. The `bank_staff` cookie only remembers which of the Owner's own
 * Staff is active: it is checked against the Owner here on every request.
 * Throws AccessDeniedError without Access.
 */
export async function requireStaff(): Promise<StaffContext> {
  const { access, owner } = await requireOwner();
  const [everyone, who, jar] = await Promise.all([bankStaff(owner), visitor(), cookies()]);
  const chosen = jar.get(STAFF_COOKIE)?.value;
  const staff =
    (isUuid(chosen) ? everyone.find((member) => member.id === chosen) : null) ??
    defaultStaff(everyone);
  if (!staff) throw new Error("The bank has no Staff");
  return { access, owner, staff, everyone, visitor: who };
}

export const actorOf = (
  context: Pick<StaffContext, "owner" | "staff">,
  via: Via = "app",
  sessionId: string | null = null,
): Actor => ({ owner: context.owner, staff: context.staff, via, sessionId });

/** Signs the visitor in as another Staff member of their own bank, and says so in the trail. */
export async function switchStaff(staffId: string): Promise<Staff> {
  const context = await requireStaff();
  const to = context.everyone.find((member) => member.id === staffId);
  if (!to) throw new NotFoundError("That Staff member is not in this bank.");
  (await cookies()).set(STAFF_COOKIE, to.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  if (to.id !== context.staff.id) {
    await auditIn(sql(), { actor: actorOf({ owner: context.owner, staff: to }) }, {
      action: "staff.switched",
      summary: `Signed in as ${to.name} (${to.role}), was ${context.staff.name}`,
      target: { kind: "staff", id: to.id },
      detail: { from: context.staff.name, to: to.name },
    });
  }
  return to;
}
