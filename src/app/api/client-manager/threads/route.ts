import {
  type ThreadsResponse,
  threadPatchSchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's chats, newest first. */
export const GET = clientManagerApi.handle(
  async ({ services, owner }): Promise<ThreadsResponse> => ({
    threads: await services.threads.list(owner),
  }),
);

/** A new chat, about every client or one. */
export const POST = clientManagerApi
  .use(body(threadPatchSchema, { limit: 4 * 1024 }))
  .handle(({ services, caller, body }) => services.threads.open(caller, body));
