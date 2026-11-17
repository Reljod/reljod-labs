import { z } from "zod";
import type { RuleResponse } from "@/features/harness/domain/api";
import { requirePermission } from "@/features/harness/server/context";
import { bodyOf, failure, json } from "@/features/harness/server/respond";
import { saveRule } from "@/features/harness/server/rules";

type Context = { params: Promise<{ id: string }> };

/** Shape only: the Rule's own schema (type, range, options) is checked by `validateRuleEdit`, which answers with the field at fault. */
const saveSchema = z.object({
  enabled: z.unknown().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  outcome: z.unknown().optional(),
  effectiveFrom: z.unknown().optional(),
  note: z.string().max(2_000).nullish(),
});

/** Saves a new Version of a Rule (admin). A refused edit answers 400 with `errors`. */
export async function PUT(request: Request, { params }: Context) {
  try {
    const context = await requirePermission("rule.edit");
    const { id } = await params;
    const { note, ...edit } = saveSchema.parse(await bodyOf(request));
    const rule = await saveRule({
      ...context,
      ruleId: id,
      edit: edit as Parameters<typeof saveRule>[0]["edit"],
      note,
    });
    return json<RuleResponse>({ rule });
  } catch (error) {
    return failure(error);
  }
}
