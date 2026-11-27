import {
  type RulesResponse,
  ruleParamsSchema,
  ruleRequestSchema,
} from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";
import { body, params } from "@/platform/http/middleware";

/** One Rule's override for this Owner; `{ override: null }` puts it back to the default. */
export const PUT = handoverApi
  .use(params(ruleParamsSchema))
  .use(body(ruleRequestSchema))
  .handle(async ({ services, owner, path, body }): Promise<RulesResponse> => {
    const saved = await services.settings.saveRule(
      owner,
      path.ruleId,
      body.override,
    );
    return {
      rules: saved.rules,
      ruleOverrides: saved.ruleOverrides,
      rulesVersion: saved.rulesVersion,
    };
  });
