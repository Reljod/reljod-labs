import { turnSchema } from "@/features/switchboard/domain/api";
import type { TurnStreamPart } from "@/features/switchboard/domain/contract";
import { callPath, switchboardApi } from "@/features/switchboard/server/api";
import { body, params } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// A Turn may take up to `LIMITS.stepsPerTurn` model steps and tool calls.
export const maxDuration = 120;

/**
 * One typed Caller Turn on the text Line, answered as NDJSON
 * `TurnStreamPart`s. The service refuses before the first line (no Access, a
 * limit, a Call that is over), so a refusal is still a JSON error.
 */
export const POST = switchboardApi
  .use(params(callPath))
  .use(body(turnSchema))
  .handle(async ({ services, caller, path, body, request }) =>
    ndjson<TurnStreamPart>(
      await services.calls.turn(
        caller,
        path.id,
        body.text,
        "text",
        request.signal,
      ),
      {
        scope: "switchboard",
        signal: request.signal,
        onError: () => ({
          kind: "error",
          message: "The Agent could not answer. Try that again.",
        }),
      },
    ),
  );
