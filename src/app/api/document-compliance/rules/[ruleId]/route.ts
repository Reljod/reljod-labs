import {
  type RuleWriteResponse,
  ruleEditSchema,
  rulePathSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { body, params } from "@/platform/http/middleware";

/**
 * An edit to a Rule, saved as its next Version. The Rule checks the edit; a
 * refusal is a 400 with `errors`, one per Parameter.
 */
export const PATCH = documentComplianceApi
  .use(params(rulePathSchema))
  .use(body(ruleEditSchema))
  .handle(
    ({ services, caller, path, body }): Promise<RuleWriteResponse> =>
      services.rules.save(caller, path.ruleId, body),
  );
