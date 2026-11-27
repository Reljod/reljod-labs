import type { RuleHistoryResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { params } from "@/platform/http/middleware";

/** A Rule's saved Versions, newest first. */
export const GET = harnessApi.use(params(idSchema)).handle(
  async ({ services, caller, path }): Promise<RuleHistoryResponse> => ({
    versions: await services.rules.history(caller, path.id),
  }),
);
