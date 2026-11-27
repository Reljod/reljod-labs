import { z } from "zod";
import type { SkillResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, body, params } from "@/platform/http/middleware";

const saveSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(5_000),
  body: z.string().max(200_000),
  note: z.string().max(2_000).nullish(),
});

/** A Skill and its saved Versions, newest first. */
export const GET = harnessApi
  .use(params(idSchema))
  .handle(
    ({ services, caller, path }): Promise<SkillResponse> =>
      services.skills.get(caller, path.id),
  );

/** Saves a new Version of a Skill (admin). */
export const PUT = harnessApi
  .use(authorize(permits("skill.edit")))
  .use(params(idSchema))
  .use(body(saveSchema, { limit: 512 * 1024 }))
  .handle(({ services, caller, path, body }): Promise<SkillResponse> => {
    const { note, ...text } = body;
    return services.skills.save(caller, path.id, text, note);
  });
