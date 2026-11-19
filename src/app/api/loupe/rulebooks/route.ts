import { requireOwner } from "@/features/access/server/gate";
import type { RulebookListResponse } from "@/features/loupe/domain/api";
import { listRulebooks } from "@/features/loupe/server/repository";
import { failure, json } from "@/features/loupe/server/respond";

/** Every Rulebook version of the Owner, newest first, then the Defaults. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<RulebookListResponse>(await listRulebooks(owner));
  } catch (error) {
    return failure(error);
  }
}
