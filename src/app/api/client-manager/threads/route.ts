import {
  currentSessionId,
  ensureSessionId,
  visitor,
} from "@/features/client-manager/server/session";
import {
  openThread,
  threadsOf,
} from "@/features/client-manager/server/threads";
import { failure } from "../respond";

/** This browser's chats, newest first. */
export async function GET() {
  try {
    return Response.json({
      threads: await threadsOf(await currentSessionId()),
    });
  } catch (error) {
    return failure(error);
  }
}

/** A new chat, about every client or one. */
export async function POST(request: Request) {
  try {
    const sessionId = await ensureSessionId();
    const body = await request.json().catch(() => ({}));
    return Response.json(await openThread(body, sessionId, await visitor()));
  } catch (error) {
    return failure(error);
  }
}
