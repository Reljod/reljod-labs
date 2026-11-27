import {
  type AuditListResponse,
  auditSearchSchema,
} from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";
import { query } from "@/platform/http/middleware";

/** A page of this Owner's Audit trail: `?before=<line id>&run=<Run id>`. */
export const GET = handoverApi.use(query(auditSearchSchema)).handle(
  async ({ services, owner, query }): Promise<AuditListResponse> => ({
    events: await services.runs.audit(owner, query),
  }),
);
