import { requireOwner } from "@/features/access/server/gate";
import {
  type AuditResponse,
  parseAuditQuery,
} from "@/features/document-compliance/domain/api";
import { listAuditEvents } from "@/features/document-compliance/server/audit";
import { failure, json } from "@/features/document-compliance/server/respond";

/** The Owner's Audit trail, newest first, optionally for one run or one action. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireOwner();
    const filter = parseAuditQuery(new URL(request.url).searchParams);
    return json<AuditResponse>(await listAuditEvents(owner, filter));
  } catch (error) {
    return failure(error);
  }
}
