import { z } from "zod";
import {
  type ChatEvent,
  MAX_MESSAGE_LENGTH,
} from "@/features/casework/domain/chat-events";
import { chat } from "@/features/casework/server/chat";
import { countMessages } from "@/features/casework/server/repository";
import { E2E_VISITOR, ensureSession } from "@/features/casework/server/session";

export const maxDuration = 120;

const MESSAGES_PER_HOUR = 40;

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

  const session = await ensureSession();
  const encoder = new TextEncoder();
  const line = (event: ChatEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);

  if (session.visitor_hash !== E2E_VISITOR) {
    const recent = await countMessages({
      visitorHash: session.visitor_hash,
      since: new Date(Date.now() - 3_600_000),
    });
    if (recent >= MESSAGES_PER_HOUR) {
      return new Response(
        line({
          type: "error",
          message: `That's ${MESSAGES_PER_HOUR} messages this hour. The Specialist needs a coffee; try again soon.`,
        }),
        { headers: { "content-type": "application/x-ndjson" } },
      );
    }
  }

  const origin = new URL(request.url).origin;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of chat(session, {
          text: text.trim(),
          documentIds,
          origin,
        })) {
          controller.enqueue(line(event));
        }
      } catch (error) {
        controller.enqueue(
          line({
            type: "error",
            message:
              error instanceof Error ? error.message : "Something went wrong",
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
