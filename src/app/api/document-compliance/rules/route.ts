import { requireOwner } from "@/features/access/server/gate";
import type { RuleListResponse } from "@/features/document-compliance/domain/api";
import { failure, json } from "@/features/document-compliance/server/respond";
import { listRules } from "@/features/document-compliance/server/rules";

/** Every Rule as the Owner has it now. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<RuleListResponse>(await listRules(owner));
  } catch (error) {
    return failure(error);
  }
}
