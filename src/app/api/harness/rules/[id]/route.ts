import { z } from "zod";
import type { RuleResponse } from "@/features/harness/domain/api";
import type { RuleEdit } from "@/features/harness/domain/rules";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, body, params } from "@/platform/http/middleware";

/** Shape only: the Rule's own schema (type, range, options) is checked by `validateRuleEdit`, which answers with the field at fault. */
const saveSchema = z.object({
  enabled: z.unknown().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  outcome: z.unknown().optional(),
  effectiveFrom: z.unknown().optional(),
  note: z.string().max(2_000).nullish(),
});

/** Saves a new Version of a Rule (admin). A refused edit answers 400 with `errors`. */
export const PUT = harnessApi
  .use(authorize(permits("rule.edit")))
  .use(params(idSchema))
  .use(body(saveSchema))
  .handle(async ({ services, caller, path, body }): Promise<RuleResponse> => {
    const { note, ...edit } = body;
    return {
      rule: await services.rules.save(caller, path.id, edit as RuleEdit, note),
    };
  });
