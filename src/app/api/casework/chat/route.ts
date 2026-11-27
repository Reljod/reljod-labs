import { z } from "zod";
import { AccessDeniedError, denied } from "@/features/access/server/gate";
import {
  type ChatEvent,
  MAX_MESSAGE_LENGTH,
} from "@/features/casework/domain/chat-events";
import { chat } from "@/features/casework/server/chat";
import { LimitError, takeChatTurn } from "@/features/casework/server/runs";
import { ensureSession } from "@/features/casework/server/session";

export const maxDuration = 120;

const bodySchema = z.object({
  text: z.string().max(MAX_MESSAGE_LENGTH),
  documentIds: z.array(z.string()).max(12),
});

/** One message to the Specialist, answered as newline-delimited JSON ChatEvents. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { text, documentIds } = parsed.data;
  if (!text.trim() && documentIds.length === 0) {
    return new Response("Empty message", { status: 400 });
  }

  let session: Awaited<ReturnType<typeof ensureSession>>;
  try {
    session = await ensureSession();
  } catch (error) {
    if (error instanceof AccessDeniedError) return denied();
    throw error;
  }
  const encoder = new TextEncoder();
  const line = (event: ChatEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);

  // Every message calls the model, so the caps are taken before it: the
  // visitor's hour, the demo's day, the Owner's spend across all their Desks
  // and this Desk's own spend (LIMITS in server/runs.ts).
  try {
    await takeChatTurn(session);
  } catch (error) {
    if (!(error instanceof LimitError)) throw error;
    return new Response(line({ type: "error", message: error.message }), {
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  const origin = new URL(request.url).origin;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of chat(session, {
          text: text.trim(),
          documentIds,
          origin,
          signal: request.signal,
        })) {
          controller.enqueue(line(event));
        }
      } catch (error) {
        if (!(error instanceof LimitError)) {
          console.error("[casework] chat turn failed", error);
        }
        controller.enqueue(
          line({
            type: "error",
            message:
              error instanceof LimitError
                ? error.message
                : "Something went wrong. Try again in a moment.",
          }),
        );
      } finally {
        controller.close();
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
