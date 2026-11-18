import type { MessageListResponse } from "@/features/harness/domain/api";
import { requireStaff } from "@/features/harness/server/context";
import { failure, json, notFound } from "@/features/harness/server/respond";
import {
  listMessages,
  readableSession,
} from "@/features/harness/server/sessions";

/** A Session's messages, oldest first. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/harness/sessions/[id]/messages">,
) {
  try {
    const [context, { id }] = await Promise.all([requireStaff(), params]);
    // Both are scoped to the Owner; the messages are returned only if the
    // Staff member may read the Session.
    const [session, messages] = await Promise.all([
      readableSession(context, id),
      listMessages(context.owner, id),
    ]);
    if (!session) return notFound();
    return json<MessageListResponse>({ messages });
  } catch (error) {
    return failure(error);
  }
}
