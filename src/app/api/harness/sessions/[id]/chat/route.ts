import { getPublicOrigin } from "mcp-handler";
import { z } from "zod";
import type { ChatEvent } from "@/features/harness/domain/chat-events";
import { LIMITS } from "@/features/harness/domain/limits";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { MAX_ATTACHMENTS } from "@/features/harness/server/services/chat";
import { isAppError } from "@/platform/errors";
import { body, params } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// A turn may take up to `LIMITS.stepsPerChatTurn` model steps and tool calls.
export const maxDuration = 120;

const bodySchema = z.object({
  text: z.string().max(LIMITS.messageChars),
  attachments: z.array(z.string().max(80)).max(MAX_ATTACHMENTS).optional(),
});

/**
 * One Staff message to the Agent (`ChatRequest`), answered as NDJSON
 * `ChatEvent`s. Refusals before the stream (no Access, someone else's
 * Session, a limit) are JSON errors; after it starts, an `error` event,
 * with the reason when it is one written for the person.
 */
export const POST = harnessApi
  .use(params(idSchema))
  .use(body(bodySchema))
  .handle(async ({ services, caller, path, body, request }) =>
    ndjson<ChatEvent>(
      await services.chat.turn(
        caller,
        path.id,
        { text: body.text.trim(), attachments: body.attachments ?? [] },
        { origin: getPublicOrigin(request), signal: request.signal },
      ),
      {
        scope: "harness",
        signal: request.signal,
        onError: (error) => ({
          type: "error",
          message: isAppError(error)
            ? error.message
            : "The Agent stopped with an error. Try again.",
        }),
      },
    ),
  );
