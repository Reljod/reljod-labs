import { getPublicOrigin } from "mcp-handler";
import { headers } from "next/headers";
import { z } from "zod";
import { isSafeError } from "@/features/bank/core/errors";
import { CHAT_STUB_HEADER } from "@/features/bank/domain/api";
import type { ChatEvent } from "@/features/bank/domain/chat";
import { LIMITS } from "@/features/bank/domain/limits";
import { prepareTurn, streamTurn } from "@/features/bank/server/chat";
import { requireStaff } from "@/features/bank/server/context";
import { failure, NDJSON_HEADERS } from "@/features/bank/server/respond";

// A turn may take up to `LIMITS.stepsPerChatTurn` model steps and tool calls.
export const maxDuration = 120;

const bodySchema = z.object({ text: z.string().max(LIMITS.messageChars) });

/**
 * One message to the Teller, answered as NDJSON `ChatEvent`s. Refusals
 * before the stream (no Access, someone else's Session, a limit) are JSON
 * errors; after it starts, an `error` event.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/bank/sessions/[id]/chat">,
) {
  let turn: Awaited<ReturnType<typeof prepareTurn>>;
  try {
    const context = await requireStaff();
    const { id } = await params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const stubbed =
      context.visitor.trusted && (await headers()).get(CHAT_STUB_HEADER) === "1";
    turn = await prepareTurn({
      context,
      sessionId: id,
      text: body.text,
      origin: getPublicOrigin(request),
      stubbed,
    });
  } catch (error) {
    return failure(error);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };
      try {
        for await (const event of streamTurn(turn, request.signal)) send(event);
      } catch (error) {
        if (!isSafeError(error)) console.error("[bank] chat turn", error);
        send({
          type: "error",
          message: isSafeError(error)
            ? error.message
            : "The Teller stopped with an error. Try again.",
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
