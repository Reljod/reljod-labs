import type { ConversationResponse } from "@/features/canvas/domain/api";
import { requireCaller } from "@/features/canvas/server/caller";
import { conversationMessages } from "@/features/canvas/server/conversations";
import { failure, json } from "@/features/canvas/server/respond";
import { listViews, payloadOf } from "@/features/canvas/server/views";

/** One of the Owner's Conversations: its messages and its Views. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/canvas/conversations/[id]">,
) {
  try {
    const [caller, { id }] = await Promise.all([requireCaller(), params]);
    // Throws NotFound when the Conversation is not this Owner's.
    const messages = await conversationMessages(caller, id);
    const views = await listViews(caller, id);
    return json<ConversationResponse>({
      messages,
      views: views.map((view) => payloadOf(view)),
    });
  } catch (error) {
    return failure(error);
  }
}
