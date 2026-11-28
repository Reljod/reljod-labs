import type { RuleListResponse } from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";

/** Every Rule as the Owner has it now. */
export const GET = documentComplianceApi.handle(
  ({ services, owner }): Promise<RuleListResponse> =>
    services.rules.list(owner),
);
