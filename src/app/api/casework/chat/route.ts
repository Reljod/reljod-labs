import { chatRequestSchema } from "@/features/casework/domain/api";
import type { ChatEvent } from "@/features/casework/domain/chat-events";
import { caseworkApi, withDesk } from "@/features/casework/server/api";
import { isAppError } from "@/platform/errors";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

export const maxDuration = 120;

/**
 * One message to the Specialist, answered as NDJSON ChatEvents. Its caps are
 * taken before the model is called, so a refusal is a JSON 429; after the
 * first line, a failure is an `error` line in the stream.
 */
export const POST = caseworkApi
  .use(body(chatRequestSchema))
  .use(withDesk({ create: true }))
  .handle(async ({ services, owner, visitor, desk, body, request }) =>
    ndjson<ChatEvent>(
      await services.chat.turn({ owner, visitor }, desk, {
        text: body.text,
        documentIds: body.documentIds,
        origin: new URL(request.url).origin,
        signal: request.signal,
      }),
      {
        scope: "casework",
        signal: request.signal,
        onError: (error) => ({
          type: "error",
          message: isAppError(error)
            ? error.message
            : "Something went wrong. Try again in a moment.",
        }),
      },
    ),
  );
