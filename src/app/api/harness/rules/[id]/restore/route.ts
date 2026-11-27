import { z } from "zod";
import type { RuleResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, body, params } from "@/platform/http/middleware";

const restoreSchema = z.object({
  version: z.number().int().min(0).nullish(),
});

/** Puts back the Default (no `version`) or an earlier Version, as a new Version (admin). */
export const POST = harnessApi
  .use(authorize(permits("rule.edit")))
  .use(params(idSchema))
  .use(body(restoreSchema))
  .handle(
    async ({ services, caller, path, body }): Promise<RuleResponse> => ({
      rule: await services.rules.restore(caller, path.id, body.version),
    }),
  );
