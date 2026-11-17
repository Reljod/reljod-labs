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
    const context = await requireStaff();
    const { id } = await params;
    const session = await readableSession(context, id);
    if (!session) return notFound();
    return json<MessageListResponse>({
      messages: await listMessages(context.owner, session.id),
    });
  } catch (error) {
    return failure(error);
  }
}
