import { getPublicOrigin } from "mcp-handler";
import { headers } from "next/headers";
import { z } from "zod";
import type { ChatEvent } from "@/features/harness/domain/chat-events";
import { LIMITS } from "@/features/harness/domain/limits";
import { CHAT_STUB_HEADER } from "@/features/harness/domain/mcp-tools";
import {
  MAX_ATTACHMENTS,
  prepareTurn,
  streamTurn,
} from "@/features/harness/server/chat";
import { requireStaff } from "@/features/harness/server/context";
import {
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
  StateError,
} from "@/features/harness/server/errors";
import {
  bodyOf,
  failure,
  NDJSON_HEADERS,
} from "@/features/harness/server/respond";

// A turn may take up to `LIMITS.stepsPerChatTurn` model steps and tool calls.
export const maxDuration = 120;

/** Errors whose message is written for the person, so the stream may show it. */
const SAFE_ERRORS = [
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
  StateError,
];

const bodySchema = z.object({
  text: z.string().max(LIMITS.messageChars),
  attachments: z.array(z.string().max(80)).max(MAX_ATTACHMENTS).optional(),
});

/**
 * One Staff message to the Agent (`ChatRequest`), answered as NDJSON
 * `ChatEvent`s. Refusals before the stream (no Access, someone else's
 * Session, a limit) are JSON errors; after it starts, an `error` event.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/harness/sessions/[id]/chat">,
) {
  let turn: Awaited<ReturnType<typeof prepareTurn>>;
  try {
    const context = await requireStaff();
    const { id } = await params;
    const body = bodySchema.parse(await bodyOf(request));
    const stubbed =
      context.visitor.trusted &&
      (await headers()).get(CHAT_STUB_HEADER) === "1";
    turn = await prepareTurn({
      context,
      sessionId: id,
      text: body.text.trim(),
      attachments: body.attachments ?? [],
      origin: getPublicOrigin(request),
      stubbed,
    });
  } catch (error) {
    return failure(error);
  }

  const encoder = new TextEncoder();
  const line = (event: ChatEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The client may be gone; writing to a closed stream must not throw.
      const send = (event: ChatEvent) => {
        try {
          controller.enqueue(line(event));
        } catch {}
      };
      try {
        for await (const event of streamTurn(turn, request.signal)) {
          send(event);
        }
      } catch (error) {
        const known = SAFE_ERRORS.some((kind) => error instanceof kind);
        if (!known) console.error("[harness] chat turn", error);
        send({
          type: "error",
          message: known
            ? (error as Error).message
            : "The Agent stopped with an error. Try again.",
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
