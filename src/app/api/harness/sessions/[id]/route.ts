import { z } from "zod";
import type { SessionResponse } from "@/features/harness/domain/api";
import { SESSION_TITLE_CHARS } from "@/features/harness/domain/session";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { body, params } from "@/platform/http/middleware";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(SESSION_TITLE_CHARS),
});

/** One Session: the Staff member's own, or any in the Workspace for an admin. */
export const GET = harnessApi.use(params(idSchema)).handle(
  async ({ services, caller, path }): Promise<SessionResponse> => ({
    session: await services.sessions.get(caller, path.id),
  }),
);

/** Renames a Session of the Staff member's own. */
export const PATCH = harnessApi
  .use(params(idSchema))
  .use(body(patchSchema))
  .handle(
    async ({ services, caller, path, body }): Promise<SessionResponse> => ({
      session: await services.sessions.rename(caller, path.id, body.title),
    }),
  );
