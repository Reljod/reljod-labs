import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";

/** The fields of a client row the Owner rules read. */
type Scoped = { owner: string | null; is_sample: boolean };

/**
 * Who may read a client: everyone may read a Sample; anyone else's client
 * only its Owner. A legacy row with no Owner is shown to nobody.
 */
export function canView(client: Scoped, owner: Owner | null): boolean {
  return client.is_sample || (!!owner && client.owner === owner);
}

/**
 * Who may change a client (add to it, start or stop its Builds, delete it,
 * set its Portrait): its Owner. A Sample is read-only, except to the e2e
 * suite and the seed script (a trusted visitor), which build the Samples.
 */
export function canChange(
  client: Scoped,
  caller: { owner: Owner | null; visitor: Pick<Visitor, "trusted"> | null },
): boolean {
  return (
    (!!caller.owner && client.owner === caller.owner) ||
    (client.is_sample && !!caller.visitor?.trusted)
  );
}
