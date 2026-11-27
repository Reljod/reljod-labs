import { getPublicOrigin } from "mcp-handler";
import {
  chatBodySchema,
  sessionParamsSchema,
} from "@/features/bank/domain/api";
import type { ChatEvent } from "@/features/bank/domain/chat";
import { bankApi } from "@/features/bank/server/api";
import { isAppError } from "@/platform/errors";
import { body, params } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// A turn may take up to `LIMITS.stepsPerChatTurn` model steps and tool calls.
export const maxDuration = 120;

/**
 * One message to the Teller, answered as NDJSON `ChatEvent`s. Refusals
 * before the stream (no Access, someone else's Session, a limit) are JSON
 * errors; after it starts, an `error` event. The e2e suite gets the canned
 * Teller from the container unless it sends `x-e2e-live: 1`.
 */
export const POST = bankApi
  .use(params(sessionParamsSchema))
  .use(body(chatBodySchema))
  .handle(async ({ services, context, path, body, request }) =>
    ndjson<ChatEvent>(
      await services.chat.turn({
        context,
        sessionId: path.id,
        text: body.text,
        origin: getPublicOrigin(request),
        signal: request.signal,
      }),
      {
        scope: "bank",
        signal: request.signal,
        onError: (error) => ({
          type: "error",
          message: isAppError(error)
            ? error.message
            : "The Teller stopped with an error. Try again.",
        }),
      },
    ),
  );
