import type { ConversationResponse } from "@/features/canvas/domain/api";
import { canvasApi, idSchema } from "@/features/canvas/server/api";
import { params } from "@/platform/http/middleware";

const route = canvasApi.use(params(idSchema));

/** One of the Owner's Conversations: its messages and its Views. */
export const GET = route.handle(
  ({ services, owner, path }): Promise<ConversationResponse> =>
    services.conversations.open(owner, path.id),
);

/** Deletes the Conversation, its messages and its unpinned Views (soft: the purge cron removes them after 30 days). */
export const DELETE = route.handle(({ services, caller, path }) =>
  services.conversations.remove(caller, path.id),
);
