import { getPublicOrigin } from "mcp-handler";
import { headers } from "next/headers";
import { z } from "zod";
import type { ChatEvent } from "@/features/canvas/domain/chat";
import { LIMITS } from "@/features/canvas/domain/limits";
import { CHAT_STUB_HEADER } from "@/features/canvas/domain/stub";
import { answer, type Turn } from "@/features/canvas/server/analyst";
import { requireCallerAccess } from "@/features/canvas/server/caller";
import { fileQuestion } from "@/features/canvas/server/conversations";
import { InvalidError, isSafeError } from "@/features/canvas/server/errors";
import { takeRate } from "@/features/canvas/server/rate";
import {
  bodyOf,
  failure,
  NDJSON_HEADERS,
} from "@/features/canvas/server/respond";

// Up to `LIMITS.turnsPerQuestion` model turns, each with Sandbox work.
export const maxDuration = 300;

const bodySchema = z.object({
  text: z.string().max(LIMITS.questionChars),
  conversationId: z.string().uuid().optional(),
});

/**
 * One Question to the Analyst, answered as NDJSON `ChatEvent`s. Refusals
 * before the stream (no Access, a limit, someone else's Conversation) are
 * JSON errors; after it starts, an `error` event.
 */
export async function POST(request: Request) {
  let turn: Turn;
  let first: ChatEvent;
  try {
    const { caller, access } = await requireCallerAccess();
    const body = bodySchema.parse(await bodyOf(request));
    const text = body.text.trim();
    if (!text) throw new InvalidError("Ask a Question first.");
    const stub =
      caller.visitor.trusted && (await headers()).get(CHAT_STUB_HEADER) === "1";
    // Taken before anything is filed or any model is called.
    await takeRate(caller.visitor, caller.owner, "question");
    const filed = await fileQuestion(caller, {
      conversationId: body.conversationId,
      text,
    });
    turn = {
      access,
      caller: {
        ...caller,
        conversationId: filed.conversationId,
        questionId: filed.questionId,
      },
      origin: getPublicOrigin(request),
      text,
      stub,
      signal: request.signal,
    };
    first = { type: "question", ...filed };
  } catch (error) {
    return failure(error);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The client may be gone; writing to a closed stream must not throw.
      const send = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };
      send(first);
      try {
        for await (const event of answer(turn)) send(event);
      } catch (error) {
        if (!isSafeError(error)) console.error("[canvas] chat turn", error);
        send({
          type: "error",
          message: isSafeError(error)
            ? error.message
            : "The Analyst stopped with an error. Try again.",
        });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}
