import "server-only";
import { cookies } from "next/headers";
import { AccessDeniedError, requireOwner } from "@/features/access/server/gate";
import { currentRequest } from "@/platform/request/current";
import { STAFF_COOKIE } from "../domain/api";
import type { Staff } from "../domain/staff";
import { harness } from "./container";
import type { Caller } from "./ports";
import type { HarnessServices } from "./services";

/**
 * The Staff gate for a page's server component: the Access gate once, then
 * the Owner's Workspace (seeded on first use) and the Staff member the
 * visitor is signed in as, through the same service the REST stack's
 * `withStaff` uses. Null without Access, so the page can send the visitor
 * to the door. The page then reads its first view through `services`.
 */
export async function signedIn(): Promise<{
  caller: Caller;
  everyone: Staff[];
  services: HarnessServices;
} | null> {
  const [owned, { mode, visitor }, jar] = await Promise.all([
    requireOwner().catch((error: unknown) => {
      if (error instanceof AccessDeniedError) return null;
      throw error;
    }),
    currentRequest(),
    cookies(),
  ]);
  if (!owned) return null;
  const services = harness(mode);
  const { staff, everyone } = await services.staff.resolve(
    owned.owner,
    jar.get(STAFF_COOKIE)?.value,
  );
  return {
    caller: { access: owned.access, owner: owned.owner, staff, visitor },
    everyone,
    services,
  };
}
