import type { SkillListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";

/** Every Skill as the Workspace has it, Rulebooks included. */
export const GET = harnessApi.handle(
  async ({ services, caller }): Promise<SkillListResponse> => ({
    skills: await services.skills.list(caller),
  }),
);
