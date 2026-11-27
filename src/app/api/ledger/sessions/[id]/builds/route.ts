import { questionSchema } from "@/features/ledger/domain/api";
import type { BuildEvent } from "@/features/ledger/domain/build-events";
import { ledgerApi, sessionPath } from "@/features/ledger/server/api";
import { body, params } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

export const maxDuration = 120;

/**
 * Plans the next Build of the caller's Ask session, streamed as NDJSON
 * `BuildEvent`s. An empty question or another Owner's session is refused as
 * JSON before the stream; the rate hit is taken before the planner is asked.
 */
export const POST = ledgerApi
  .use(params(sessionPath))
  .use(body(questionSchema))
  .handle(async ({ services, caller, ask, path, body, request }) =>
    ndjson<BuildEvent>(
      await services.build(caller, path.id, body.question, ask),
      {
        scope: "ledger",
        signal: request.signal,
        onError: () => ({
          type: "error",
          message: "Ledger tripped over his tail. Please try again.",
        }),
      },
    ),
  );
