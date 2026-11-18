import { requireOwner } from "@/features/access/server/gate";
import type { RulebookListResponse } from "@/features/name-extraction/domain/api";
import { rulebookVersions } from "@/features/name-extraction/server/repository";
import { failure, json } from "@/features/name-extraction/server/respond";

/** Every Rulebook version the Owner saved, newest first, then the default: the first is the current one. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<RulebookListResponse>(await rulebookVersions(owner));
  } catch (error) {
    return failure(error);
  }
}
