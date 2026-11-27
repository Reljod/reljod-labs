import "server-only";
import { unstable_rethrow } from "next/navigation";
import { type Owner, ownerOf } from "@/features/access/domain/owner";
import { currentAccess } from "@/features/access/server/gate";
import { currentRequest } from "@/platform/request/current";
import {
  type DocumentComplianceServices,
  documentCompliance,
} from "./container";

/**
 * A page's first view, read while it renders, through the same services as
 * the REST routes, so the data arrives with the page instead of after
 * hydration. The gate runs once; `read` gets the Owner and should load
 * everything with `Promise.all`. Undefined without Access or on a failure:
 * the screen then reads through the API and shows its own error.
 */
export async function initialFor<T>(
  what: string,
  read: (services: DocumentComplianceServices, owner: Owner) => Promise<T>,
): Promise<T | undefined> {
  try {
    const [access, { mode }] = await Promise.all([
      currentAccess(),
      currentRequest(),
    ]);
    if (!access) return undefined;
    return await read(documentCompliance(mode), ownerOf(access));
  } catch (error) {
    // Next's own signals (the prerender leaving at the first request read)
    // must reach Next, or the page is prerendered without its data.
    unstable_rethrow(error);
    console.error(`[document-compliance] could not read ${what}`, error);
    return undefined;
  }
}
