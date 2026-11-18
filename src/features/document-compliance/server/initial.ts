import "server-only";
import { unstable_rethrow } from "next/navigation";
import { type Owner, ownerOf } from "@/features/access/domain/owner";
import { currentAccess } from "@/features/access/server/gate";

/**
 * A page's first view, read while it renders so the data arrives with the
 * page instead of after hydration. `read` gets the Owner once and should load
 * everything with `Promise.all`. Undefined without Access or on a failure:
 * the screen then reads through the API and shows its own error.
 */
export async function initialFor<T>(
  what: string,
  read: (owner: Owner) => Promise<T>,
): Promise<T | undefined> {
  try {
    const access = await currentAccess();
    if (!access) return undefined;
    return await read(ownerOf(access));
  } catch (error) {
    // Next's own signals (the prerender leaving at the first request read)
    // must reach Next, or the page is prerendered without its data.
    unstable_rethrow(error);
    console.error(`[document-compliance] could not read ${what}`, error);
    return undefined;
  }
}
