import type { SkillListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { failure, json } from "@/features/harness/server/respond";
import { listSkills } from "@/features/harness/server/skills";

/** Every Skill as the Workspace has it, Rulebooks included. */
export async function GET() {
  try {
    const context = await requireStaff();
    return json<SkillListResponse>({ skills: await listSkills(context.owner) });
  } catch (error) {
    return failure(error);
  }
}
