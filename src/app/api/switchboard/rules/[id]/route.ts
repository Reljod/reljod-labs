import {
  ruleEditSchema,
  type SavedRuleResponse,
} from "@/features/switchboard/domain/api";
import { rulePath, switchboardApi } from "@/features/switchboard/server/api";
import { body, params } from "@/platform/http/middleware";

/**
 * Saves an edit of one Rule as its next Version; the next Call starts under
 * it. A bad edit answers 400 with every problem in `errors`.
 */
export const PUT = switchboardApi
  .use(params(rulePath))
  .use(body(ruleEditSchema))
  .handle(
    ({ services, owner, path, body }): Promise<SavedRuleResponse> =>
      services.rules.save(owner, { ruleId: path.id, ...body }),
  );
