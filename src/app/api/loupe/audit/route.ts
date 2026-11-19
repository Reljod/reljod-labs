import { requireOwner } from "@/features/access/server/gate";
import type { AuditResponse } from "@/features/loupe/domain/api";
import { listAudit } from "@/features/loupe/server/repository";
import { failure, json } from "@/features/loupe/server/respond";

/** The Owner's Audit trail, newest first. */
export async function GET() {
  try {
    const { owner } = await requireOwner();
    return json<AuditResponse>(await listAudit(owner));
  } catch (error) {
    return failure(error);
  }
}
