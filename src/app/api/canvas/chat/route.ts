import { questionSchema } from "@/features/canvas/domain/api";
import type { ChatEvent } from "@/features/canvas/domain/chat";
import { canvasApi } from "@/features/canvas/server/api";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Up to `LIMITS.turnsPerQuestion` model turns, each with Sandbox work.
export const maxDuration = 300;

/**
 * One Question to the Analyst, answered as NDJSON `ChatEvent`s. Refusals
 * before the stream (no Access, a limit, someone else's Conversation) are
 * JSON errors; after it starts, an `error` event.
 */
export const POST = canvasApi
  .use(body(questionSchema))
  .handle(async ({ services, access, caller, origin, body, request }) =>
    ndjson<ChatEvent>(
      await services.chat.ask(access, caller, body, {
        origin,
        signal: request.signal,
      }),
      {
        scope: "canvas",
        signal: request.signal,
        onError: () => ({
          type: "error",
          message: "The Analyst stopped with an error. Try again.",
        }),
      },
    ),
  );
