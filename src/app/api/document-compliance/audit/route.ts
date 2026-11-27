import {
  type AuditResponse,
  auditQuerySchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { query } from "@/platform/http/middleware";

/** The Owner's Audit trail, newest first, optionally for one run or one action. */
export const GET = documentComplianceApi
  .use(query(auditQuerySchema))
  .handle(
    ({ services, owner, query }): Promise<AuditResponse> =>
      services.audit.list(owner, query),
  );
