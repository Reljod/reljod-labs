import { z } from "zod";
import type { SkillResponse } from "@/features/harness/domain/api";
import { requirePermission } from "@/features/harness/server/context";
import { bodyOf, failure, json } from "@/features/harness/server/respond";
import { restoreSkill, skillHistory } from "@/features/harness/server/skills";

type Context = { params: Promise<{ id: string }> };

const restoreSchema = z.object({
  version: z.number().int().min(0).nullish(),
});

/** Puts back the Default (no `version`) or an earlier Version, as a new Version (admin). */
export async function POST(request: Request, { params }: Context) {
  try {
    const context = await requirePermission("skill.edit");
    const { id } = await params;
    const { version } = restoreSchema.parse(await bodyOf(request));
    const skill = await restoreSkill({ ...context, skillId: id, version });
    return json<SkillResponse>({
      skill,
      history: await skillHistory(context.owner, id),
    });
  } catch (error) {
    return failure(error);
  }
}
