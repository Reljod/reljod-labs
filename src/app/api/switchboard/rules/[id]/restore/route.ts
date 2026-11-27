import type { SavedRuleResponse } from "@/features/switchboard/domain/api";
import { rulePath, switchboardApi } from "@/features/switchboard/server/api";
import { params } from "@/platform/http/middleware";

/** Puts a Rule back to its Default, as a new Version. */
export const POST = switchboardApi
  .use(params(rulePath))
  .handle(
    ({ services, owner, path }): Promise<SavedRuleResponse> =>
      services.rules.restore(owner, path.id),
  );
