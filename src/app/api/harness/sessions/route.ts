import { z } from "zod";
import type {
  SessionListResponse,
  SessionResponse,
} from "@/features/harness/domain/api";
import { SESSION_TITLE_CHARS } from "@/features/harness/domain/session";
import { harnessApi, permits } from "@/features/harness/server/api";
import { authorize, body } from "@/platform/http/middleware";

const createSchema = z.object({
  title: z.string().trim().min(1).max(SESSION_TITLE_CHARS).optional(),
});

/** The signed-in Staff member's Sessions, latest activity first. */
export const GET = harnessApi.handle(
  async ({ services, caller }): Promise<SessionListResponse> => ({
    sessions: await services.sessions.list(caller),
  }),
);

/** Opens a Session for the signed-in Staff member. */
export const POST = harnessApi
  .use(authorize(permits("session.create")))
  .use(body(createSchema))
  .handle(
    async ({ services, caller, body }): Promise<SessionResponse> => ({
      session: await services.sessions.create(caller, body.title),
    }),
  );
