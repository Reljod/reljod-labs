import { requireOwner } from "@/features/access/server/gate";
import {
  type AuditListResponse,
  parseAuditQuery,
} from "@/features/process-transfer/domain/api";
import { readAudit } from "@/features/process-transfer/server/reads";
import { failure, json } from "@/features/process-transfer/server/respond";

/** A page of this Owner's Audit trail: `?before=<line id>&run=<Run id>`. */
export async function GET(request: Request) {
  try {
    const { owner } = await requireOwner();
    const query = parseAuditQuery(new URL(request.url).searchParams);
    return json<AuditListResponse>({ events: await readAudit(owner, query) });
  } catch (error) {
    return failure(error);
  }
}
