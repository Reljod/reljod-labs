import type { ConversationListResponse } from "@/features/canvas/domain/api";
import { canvasApi } from "@/features/canvas/server/api";

/** The Owner's Conversations, latest first. */
export const GET = canvasApi.handle(
  async ({ services, owner }): Promise<ConversationListResponse> => ({
    conversations: await services.conversations.list(owner),
  }),
);
