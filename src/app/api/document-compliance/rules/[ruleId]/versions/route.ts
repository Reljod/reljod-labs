import {
  type RuleVersionsResponse,
  rulePathSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { params } from "@/platform/http/middleware";

/** One Rule's saved Versions for this Owner, newest first, then its Default. */
export const GET = documentComplianceApi
  .use(params(rulePathSchema))
  .handle(
    ({ services, owner, path }): Promise<RuleVersionsResponse> =>
      services.rules.versions(owner, path.ruleId),
  );
