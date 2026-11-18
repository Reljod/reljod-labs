import type { ThreadResponse } from "@/features/client-manager/domain/api";
import { deleteThread } from "@/features/client-manager/server/repository";
import {
  failure,
  json,
  notFound,
} from "@/features/client-manager/server/respond";
import { currentOwner } from "@/features/client-manager/server/session";
import {
  gatedThread,
  messagesOf,
  ownedThread,
  patchThread,
  summaryOf,
} from "@/features/client-manager/server/threads";

type Context = RouteContext<"/api/client-manager/threads/[threadId]">;

export async function GET(_request: Request, { params }: Context) {
  try {
    const { threadId } = await params;
    const { thread } = await gatedThread(threadId);
    if (!thread) return notFound();
    return json<ThreadResponse>({
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
    const owner = await currentOwner();
    const thread = await ownedThread(threadId, owner);
    if (!thread || !owner) return notFound();
    await patchThread(thread, await request.json(), owner);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { threadId } = await params;
    const thread = await ownedThread(threadId, await currentOwner());
    if (!thread) return notFound();
    await deleteThread(thread.id);
    return json({ deleted: true });
  } catch (error) {
    return failure(error);
  }
}
