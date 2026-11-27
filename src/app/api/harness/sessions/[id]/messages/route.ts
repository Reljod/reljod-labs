import type { MessageListResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { params } from "@/platform/http/middleware";

/** A Session's messages, oldest first, when the Staff member may read it. */
export const GET = harnessApi.use(params(idSchema)).handle(
  async ({ services, caller, path }): Promise<MessageListResponse> => ({
    messages: await services.sessions.messages(caller, path.id),
  }),
);
