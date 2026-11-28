import {
  runEventsQuerySchema,
  runParamsSchema,
} from "@/features/casework/domain/api";
import type { RunEvent } from "@/features/casework/domain/run-events";
import { caseworkApi } from "@/features/casework/server/api";
import { params, query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the run streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/**
 * A Run's events as NDJSON, from the `from`th on, to the open Desk that owns
 * it (404 for any other). A Run that ended streams to its end and closes.
 */
export const GET = caseworkApi
  .use(params(runParamsSchema))
  .use(query(runEventsQuerySchema))
  .handle(async ({ services, owner, rememberedId, path, query, request }) =>
    ndjson<RunEvent>(
      await services.runs.events(owner, rememberedId, path.runId, query.from),
      { scope: "casework", signal: request.signal },
    ),
  );
