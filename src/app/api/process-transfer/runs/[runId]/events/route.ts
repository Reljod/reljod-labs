import {
  eventsQuerySchema,
  runParamsSchema,
} from "@/features/process-transfer/domain/api";
import type { RunEvent } from "@/features/process-transfer/domain/run";
import { handoverApi } from "@/features/process-transfer/server/api";
import { params, query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the Run streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/**
 * Streams a Run's events as NDJSON, to the Owner of the Run. A finished
 * Run's replay ends once it goes quiet, with an `end` line when nobody
 * wrote one. A dropped stream is picked up again with `from`.
 */
export const GET = handoverApi
  .use(params(runParamsSchema))
  .use(query(eventsQuerySchema))
  .handle(async ({ services, owner, path, query, request }) =>
    ndjson<RunEvent>(
      await services.runs.events(owner, path.runId, query.from),
      { scope: "process-transfer", signal: request.signal },
    ),
  );
