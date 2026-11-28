import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import type { ConversationResponse } from "../../domain/api";
import type { ConversationSummary } from "../../domain/chat";
import { isUuid } from "../../domain/ids";
import { LIMITS } from "../../domain/limits";
import type { Caller, ConversationRepository } from "../ports";
import { payloadOf, type ViewService } from "./views";

/** The Owner's Conversations: listed, opened with their Views, and deleted. */
export interface ConversationService {
  list(owner: Owner): Promise<ConversationSummary[]>;
  /** Its messages and its Views; 404 when it is not the Owner's. */
  open(owner: Owner, id: string): Promise<ConversationResponse>;
  /**
   * Deletes a Conversation, its messages and its Views. A View pinned to a
   * Board stays, without its Conversation. The delete is soft: every read
   * stops seeing them at once, and the purge cron removes the rows after 30
   * days.
   */
  remove(caller: Caller, id: string): Promise<void>;
}

const MISSING = "No such Conversation.";

export function createConversationService(ports: {
  conversations: ConversationRepository;
  views: Pick<ViewService, "list">;
}): ConversationService {
  const { conversations, views } = ports;
  return {
    list: (owner) => conversations.list(owner, LIMITS.conversationsPerOwner),

    async open(owner, id) {
      if (!isUuid(id)) throw new NotFoundError(MISSING);
      // All three are scoped to the Owner, so they run together; the
      // messages and Views of a Conversation that is not theirs are empty.
      const [found, messages, viewed] = await Promise.all([
        conversations.exists(owner, id),
        conversations.messages(owner, id),
        views.list(owner, id),
      ]);
      if (!found) throw new NotFoundError(MISSING);
      return { messages, views: viewed.map((view) => payloadOf(view)) };
    },

    async remove(caller, id) {
      const removed = await conversations.softDelete(caller, id, (title) => ({
        action: "conversation.deleted",
        summary: `Deleted Conversation "${title}"`,
        detail: { conversationId: id, title },
      }));
      if (!removed) throw new NotFoundError(MISSING);
    },
  };
}
