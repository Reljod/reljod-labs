import { z } from "zod";
import type { RuleResponse } from "@/features/harness/domain/api";
import { requirePermission } from "@/features/harness/server/context";
import { bodyOf, failure, json } from "@/features/harness/server/respond";
import { restoreRule } from "@/features/harness/server/rules";

type Context = { params: Promise<{ id: string }> };

const restoreSchema = z.object({
  version: z.number().int().min(0).nullish(),
});

/** Puts back the Default (no `version`) or an earlier Version, as a new Version (admin). */
export async function POST(request: Request, { params }: Context) {
  try {
    const context = await requirePermission("rule.edit");
    const { id } = await params;
    const { version } = restoreSchema.parse(await bodyOf(request));
    return json<RuleResponse>({
      rule: await restoreRule({ ...context, ruleId: id, version }),
    });
  } catch (error) {
    return failure(error);
  }
}
