import type { Owner } from "@/features/access/domain/owner";
import type { AssistantEvent } from "@/features/client-manager/domain/chat";
import { LimitError } from "@/features/client-manager/server/service";
import {
  currentOwner,
  visitor,
} from "@/features/client-manager/server/session";
import { ask, ownedThread } from "@/features/client-manager/server/threads";
import { failure, notFound } from "../../../respond";

export const maxDuration = 180;

/** One question in a chat, answered as newline-delimited JSON AssistantEvents. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/client-manager/threads/[threadId]/messages">,
) {
  let owner: Owner;
  try {
    // Passes the Access gate before anything is read or asked.
    owner = await currentOwner();
  } catch (error) {
    return failure(error);
  }
  const { threadId } = await params;
  const thread = await ownedThread(threadId, owner);
  if (!thread) return notFound();
  const body = await request.json().catch(() => null);
  const who = await visitor();
  const origin = new URL(request.url).origin;

  const encoder = new TextEncoder();
  const line = (event: AssistantEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of ask({
          thread,
          raw: body,
          owner,
          visitor: who,
          origin,
          signal: request.signal,
        })) {
          controller.enqueue(line(event));
        }
      } catch (error) {
        if (!(error instanceof LimitError))
          console.error("client-manager chat", error);
        controller.enqueue(
          line({
            type: "error",
            message:
              error instanceof LimitError
                ? error.message
                : "The desk lost its way. Try asking again.",
          }),
        );
      } finally {
        try {
          controller.close();
        } catch {
          // The browser already left.
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
