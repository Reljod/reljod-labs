import "server-only";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import {
  type Policy,
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import {
  api,
  type BaseContext,
  derive,
  type Middleware,
} from "@/platform/http/pipeline";
import type { Visitor } from "@/platform/request/visitor";
import { STAFF_COOKIE } from "../domain/api";
import { type Action, refusalFor } from "../domain/permissions";
import type { Staff } from "../domain/staff";
import { harness } from "./container";
import type { Caller } from "./ports";
import type { HarnessServices } from "./services";

/**
 * A route's `[id]`. Any text up to 200 characters: a service answers an id
 * that is not the Owner's (or not a uuid) with the same 404, so ids leak nothing.
 */
export const idSchema = z.object({ id: z.string().min(1).max(200) });

/** The cookie that remembers which of the Owner's own Staff is active. */
export function cookieOf(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

const MONTH = 60 * 60 * 24 * 30;

/** `Set-Cookie` for the Staff member now signed in (httpOnly; it only remembers a choice the gate checks again). */
export function staffCookie(staffId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${STAFF_COOKIE}=${encodeURIComponent(staffId)}; Path=/; Max-Age=${MONTH}; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * The Staff gate (ADR 0014) as a layer: from the Owner's Workspace (seeded
 * on first use, one database round once seeded) it adds the Staff member
 * the visitor is signed in as, everyone they may switch to, and `caller`,
 * what a service is handed. The `harness_staff` cookie only remembers a
 * choice: it counts only if it names one of the Owner's own Staff.
 */
export function withStaff<
  C extends BaseContext & {
    access: Access;
    owner: Owner;
    visitor: Visitor;
    services: HarnessServices;
  },
>(): Middleware<C, C & { staff: Staff; everyone: Staff[]; caller: Caller }> {
  return derive(async (context) => {
    const { staff, everyone } = await context.services.staff.resolve(
      context.owner,
      cookieOf(context.request, STAFF_COOKIE),
    );
    return {
      staff,
      everyone,
      caller: {
        access: context.access,
        owner: context.owner,
        staff,
        visitor: context.visitor,
      },
    };
  });
}

/**
 * A Role check as a policy: the refusal names the Role the action needs
 * ("Only an admin may edit Rules. Switch Staff to try it."). `can()` in
 * `domain/permissions.ts` stays the one place Roles are decided; the
 * services check again, so an MCP tool or a page is held the same way.
 */
export function permits<C extends { staff: Pick<Staff, "role"> }>(
  action: Action,
): Policy<C> {
  return ({ staff }) => refusalFor(staff, action);
}

/**
 * Harness's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, its services, and the
 * Staff member. A route adds its own Role policy and body or query layer.
 */
export const harnessApi = api("harness")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(harness))
  .use(withStaff());
