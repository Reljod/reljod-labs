import {
  threadParamsSchema,
  threadPatchSchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { body, params } from "@/platform/http/middleware";

const thread = clientManagerApi.use(params(threadParamsSchema));

/** A chat and its messages, to its Owner only. */
export const GET = thread.handle(({ services, owner, path }) =>
  services.threads.get(owner, path.threadId),
);

/** Renames a chat or changes which client it is about. */
export const PATCH = thread
  .use(body(threadPatchSchema, { limit: 4 * 1024 }))
  .handle(async ({ services, owner, path, body }) => {
    await services.threads.patch(owner, path.threadId, body);
  });

/** Deletes a chat (softly). */
export const DELETE = thread.handle(async ({ services, owner, path }) => {
  await services.threads.remove(owner, path.threadId);
});
