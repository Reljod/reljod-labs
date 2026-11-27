import type { RulesResponse } from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";

/** Every Rule back to its default; Runs already made keep the Rules they used. */
export const DELETE = handoverApi.handle(
  async ({ services, owner }): Promise<RulesResponse> => {
    const saved = await services.settings.resetRules(owner);
    return {
      rules: saved.rules,
      ruleOverrides: saved.ruleOverrides,
      rulesVersion: saved.rulesVersion,
    };
  },
);
