import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { Owner } from "@/features/access/domain/owner";
import {
  type Access,
  AccessDeniedError,
  denied,
  requireOwner,
} from "@/features/access/server/gate";
import { STAFF_COOKIE } from "../domain/api";
import { type Action, can } from "../domain/permissions";
import { defaultStaff, type Staff } from "../domain/staff";
import { audit } from "./audit";
import { isUuid } from "./db";
import { ForbiddenError, NotFoundError } from "./errors";
import { type Visitor, visitor } from "./rate";
import { NO_STORE } from "./respond";
import { listStaff } from "./staff";
import { ensureWorkspace, forgetWorkspace } from "./workspace";

/**
 * Who a request acts as: the Access that let it in, the Owner whose
 * Workspace it reaches, the Staff member the visitor is signed in as, and
 * the visitor hash its limits count against. Spread it into the server
 * functions: `startRun({ ...context, pipelineId, input, via: "app" })`.
 */
export type StaffContext = {
  access: Access;
  owner: Owner;
  staff: Staff;
  visitor: Visitor;
};

const COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
};

/**
 * The Workspace's Staff, seeding the Workspace first if it is new (or gone).
 * The seed check and the Staff read start together: on a Workspace already
 * seeded (every visit after the first) that is one database round, not two.
 */
async function workspaceStaff(owner: Owner): Promise<Staff[]> {
  const [, staff] = await Promise.all([
    ensureWorkspace(owner),
    listStaff(owner),
  ]);
  if (staff.length > 0) return staff;
  // A new Workspace (the read raced its seed), or one remembered as seeded
  // but purged since: seed it again if need be, then read once more.
  forgetWorkspace(owner);
  await ensureWorkspace(owner);
  return listStaff(owner);
}

/**
 * `requireStaff`, plus everyone in the Workspace, which the gate reads
 * anyway. For the page and the Staff route, so neither reads the Staff twice.
 */
export async function resolveStaff(): Promise<{
  context: StaffContext;
  everyone: Staff[];
}> {
  const { access, owner } = await requireOwner();
  const [staff, who, jar] = await Promise.all([
    workspaceStaff(owner),
    visitor(),
    cookies(),
  ]);
  const chosen = jar.get(STAFF_COOKIE)?.value;
  const current =
    (isUuid(chosen) ? staff.find((member) => member.id === chosen) : null) ??
    defaultStaff(staff);
  if (!current) throw new Error("The Workspace has no Staff");
  return {
    context: { access, owner, staff: current, visitor: who },
    everyone: staff,
  };
}

/**
 * The gate every Harness entry point passes (ADR 0014): the Access gate
 * (`requireOwner`), the Owner's Workspace (created with its seed on first
 * use), and the Staff member. The `harness_staff` cookie only remembers
 * which of the Owner's own Staff is active: it is checked against the Owner
 * here on every request, and anything else falls back to the first `user`.
 * Throws AccessDeniedError without Access.
 */
export async function requireStaff(): Promise<StaffContext> {
  return (await resolveStaff()).context;
}

/**
 * `requireStaff`, and the Staff member's Role must allow the action. Throws
 * a ForbiddenError that names the Role needed. Every server function that
 * writes calls this (or checks `can()` on the context it is handed).
 */
export async function requirePermission(action: Action): Promise<StaffContext> {
  const context = await requireStaff();
  if (!can(context.staff, action)) throw ForbiddenError.forAction(action);
  return context;
}

/** Throws a ForbiddenError unless the Staff member's Role allows the action. For functions handed a Staff member (the MCP server). */
export function assertCan(staff: Pick<Staff, "role">, action: Action): void {
  if (!can(staff, action)) throw ForbiddenError.forAction(action);
}

/**
 * Signs the visitor in as another Staff member of their own Workspace:
 * checks the Staff member belongs to the Owner, remembers the choice in the
 * cookie and writes a `staff.switched` Audit event. Anyone in a Workspace
 * may switch, by design (ADR 0014). Call it from a route handler or a server
 * action: a page render cannot set the cookie.
 */
export async function switchStaff(staffId: string): Promise<Staff> {
  const {
    context: { owner, staff: from },
    everyone: all,
  } = await resolveStaff();
  const to = isUuid(staffId)
    ? all.find((member) => member.id === staffId)
    : undefined;
  if (!to)
    throw new NotFoundError("That Staff member is not in this Workspace.");
  (await cookies()).set(STAFF_COOKIE, to.id, COOKIE);
  if (to.id !== from.id) {
    await audit({
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
}

/** What a route handler answers when the Role may not: 403, with why. */
export function forbidden(message = "Your Role may not do that.") {
  return Response.json(
    { error: message },
    { status: 403, headers: { "cache-control": NO_STORE } },
  );
}

/**
 * For route handlers, mirroring `accessOrDenied()`: the StaffContext, or the
 * response to return instead (401 without Access; with an action, 403 when
 * the Role may not). Other errors are thrown.
 *
 *   const context = await staffOrDenied("rule.edit");
 *   if (context instanceof Response) return context;
 */
export async function staffOrDenied(
  action?: Action,
): Promise<StaffContext | Response> {
  try {
    return action ? await requirePermission(action) : await requireStaff();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AccessDeniedError) return denied();
    if (error instanceof ForbiddenError) return forbidden(error.message);
    throw error;
  }
}
