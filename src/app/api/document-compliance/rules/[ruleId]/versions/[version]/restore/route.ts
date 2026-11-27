import {
  type RuleWriteResponse,
  versionPathSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { params } from "@/platform/http/middleware";

/** Puts an earlier Version (0 for the Default) back in force, as the Rule's next Version. */
export const POST = documentComplianceApi
  .use(params(versionPathSchema))
  .handle(
    ({ services, caller, path }): Promise<RuleWriteResponse> =>
      services.rules.restore(caller, path.ruleId, path.version),
  );
