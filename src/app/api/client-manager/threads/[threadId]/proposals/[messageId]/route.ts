import {
  currentSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import { decide, ownedThread } from "@/features/client-manager/server/threads";
import { failure, notFound } from "../../../../respond";

/** The person's pick from a research card: add the chosen findings, or dismiss them. */
export async function POST(
  request: Request,
  {
    params,
  }: RouteContext<"/api/client-manager/threads/[threadId]/proposals/[messageId]">,
) {
  try {
    const { threadId, messageId } = await params;
    const thread = await ownedThread(threadId, await currentSessionId());
    if (!thread) return notFound();
    const proposal = await decide({
      thread,
      messageId,
      raw: await request.json(),
      visitor: await visitor(),
    });
    return Response.json({ proposal });
  } catch (error) {
    return failure(error);
  }
}
