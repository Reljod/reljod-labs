import {
  askSchema,
  threadParamsSchema,
} from "@/features/client-manager/domain/api";
import type { AssistantEvent } from "@/features/client-manager/domain/chat";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { isAppError } from "@/platform/errors";
import { body, params } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

export const maxDuration = 180;

/**
 * One question in a chat. The Thread's Owner and the cap are checked before
 * the answer starts (a refusal is a plain JSON error); the answer streams as
 * newline-delimited JSON AssistantEvents.
 */
export const POST = clientManagerApi
  .use(params(threadParamsSchema))
  .use(body(askSchema, { limit: 16 * 1024 }))
  .handle(async ({ services, caller, path, body, request }) =>
    ndjson<AssistantEvent>(
      await services.threads.ask(caller, path.threadId, body, {
        origin: new URL(request.url).origin,
        signal: request.signal,
      }),
      {
        scope: "client-manager",
        signal: request.signal,
        onError: (error) => ({
          type: "error",
          message: isAppError(error)
            ? error.message
            : "The desk lost its way. Try asking again.",
        }),
      },
    ),
  );
