import type { ConversationListResponse } from "@/features/canvas/domain/api";
import { requireCaller } from "@/features/canvas/server/caller";
import { listConversations } from "@/features/canvas/server/conversations";
import { failure, json } from "@/features/canvas/server/respond";

/** The Owner's Conversations, latest first. */
export async function GET() {
  try {
    const caller = await requireCaller();
    return json<ConversationListResponse>({
      conversations: await listConversations(caller),
    });
  } catch (error) {
    return failure(error);
  }
}
