import "server-only";
import { cookies } from "next/headers";
import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import {
  sameOrigin,
  withOwner,
  withServices,
  withVisitor,
} from "@/platform/http/middleware";
import { api, derive } from "@/platform/http/pipeline";
import type { Visitor } from "@/platform/request/visitor";
import { STAFF_COOKIE } from "../domain/api";
import { type BankServices, bank } from "./container";
import type { StaffContext } from "./ports";

/** Which of the Owner's own Staff the visitor last chose. Carries no authority: `signIn` checks it. */
export async function chosenStaff(): Promise<string | null> {
  return (await cookies()).get(STAFF_COOKIE)?.value ?? null;
}

/** Remembers the Staff member the visitor switched to. */
export async function rememberStaff(staffId: string): Promise<void> {
  (await cookies()).set(STAFF_COOKIE, staffId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

/**
 * The Staff member a request acts as (the bank opened with its seed on first
 * use): the bank's own layer, after the gate and the Owner.
 */
function withStaff<
  C extends {
    access: Access;
    owner: Owner;
    visitor: Visitor;
    services: BankServices;
  },
>() {
  return derive<C, { context: StaffContext }>(async (c) => ({
    context: await c.services.staff.signIn(c, await chosenStaff()),
  }));
}

/**
 * The bank's base route stack: same-origin writes, the Access gate and the
 * Owner, the visitor hash its caps count against, its services, and the
 * Staff member signed in. Each route adds its own body, query or params.
 * The MCP route and the GitHub webhook are not on it: they check their own
 * bearer or signature.
 */
export const bankApi = api("bank")
  .use(sameOrigin())
  .use(withOwner())
  .use(withVisitor())
  .use(withServices(bank))
  .use(withStaff());
