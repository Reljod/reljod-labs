import { deleteThread } from "@/features/client-manager/server/repository";
import { currentSessionId } from "@/features/client-manager/server/session";
import {
  messagesOf,
  ownedThread,
  patchThread,
  summaryOf,
} from "@/features/client-manager/server/threads";
import { failure, notFound } from "../../respond";

type Context = RouteContext<"/api/client-manager/threads/[threadId]">;

export async function GET(_request: Request, { params }: Context) {
  try {
    const { threadId } = await params;
    const thread = await ownedThread(threadId, await currentSessionId());
    if (!thread) return notFound();
    return Response.json({
      thread: summaryOf(thread),
      messages: await messagesOf(thread),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Renames a chat or changes which client it is about. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { threadId } = await params;
    const sessionId = await currentSessionId();
    const thread = await ownedThread(threadId, sessionId);
    if (!thread || !sessionId) return notFound();
    await patchThread(thread, await request.json(), sessionId);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { threadId } = await params;
    const thread = await ownedThread(threadId, await currentSessionId());
    if (!thread) return notFound();
    await deleteThread(thread.id);
    return Response.json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
