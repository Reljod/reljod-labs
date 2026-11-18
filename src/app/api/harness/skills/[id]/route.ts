import { z } from "zod";
import type { SkillResponse } from "@/features/harness/domain/api";
import {
  requirePermission,
  requireStaff,
} from "@/features/harness/server/context";
import {
  bodyOf,
  failure,
  json,
  notFound,
} from "@/features/harness/server/respond";
import {
  getSkill,
  saveSkill,
  skillHistory,
} from "@/features/harness/server/skills";

type Context = { params: Promise<{ id: string }> };

const saveSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(5_000),
  body: z.string().max(200_000),
  note: z.string().max(2_000).nullish(),
});

/** A Skill and its saved Versions, newest first. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const [context, { id }] = await Promise.all([requireStaff(), params]);
    // Both are the Owner's; the history is answered only with its Skill.
    const [skill, history] = await Promise.all([
      getSkill(context.owner, id),
      skillHistory(context.owner, id),
    ]);
    if (!skill) return notFound("There is no such Skill.");
    return json<SkillResponse>({ skill, history });
  } catch (error) {
    return failure(error);
  }
}

/** Saves a new Version of a Skill (admin). */
export async function PUT(request: Request, { params }: Context) {
  try {
    const context = await requirePermission("skill.edit");
    const { id } = await params;
    const { note, ...text } = saveSchema.parse(await bodyOf(request));
    const skill = await saveSkill({ ...context, skillId: id, text, note });
    return json<SkillResponse>({
      skill,
      history: await skillHistory(context.owner, id),
    });
  } catch (error) {
    return failure(error);
  }
}
