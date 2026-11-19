import { requireOwner } from "@/features/access/server/gate";
import type { RulebookListResponse } from "@/features/operator/domain/api";
import { rulebookVersions } from "@/features/operator/server/repository";
import { failure, json } from "@/features/operator/server/respond";

/** Every Rulebook version the Owner saved, newest first, then the Default: the first is current. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<RulebookListResponse>(await rulebookVersions(owner));
  } catch (error) {
    return failure(error);
  }
}
