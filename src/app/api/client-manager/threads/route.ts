import {
  currentOwner,
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
      threads: await threadsOf(await currentOwner()),
    });
  } catch (error) {
    return failure(error);
  }
}

/** A new chat, about every client or one. */
export async function POST(request: Request) {
  try {
    const owner = await currentOwner();
    const body = await request.json().catch(() => ({}));
    return Response.json(await openThread(body, owner, await visitor()));
  } catch (error) {
    return failure(error);
  }
}
