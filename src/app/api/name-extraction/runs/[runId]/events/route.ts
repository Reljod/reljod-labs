import {
  eventsQuerySchema,
  runPathSchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import type { StoredEvent } from "@/features/name-extraction/server/run-row";
import { params, query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the Run streams; the client reconnects with `after`.
export const maxDuration = 300;

/**
 * Streams a Run's Audit trail as newline-delimited JSON, one
 * `RunEvent & { seq }` per line, to the Owner of the Run. `?after=<seq>`
 * resumes after the last event the client has; each poll also reads back a
 * few seqs behind the cursor, for events that committed late
 * (`server/event-cursor.ts`), so the client may get an event it already has
 * and dedupes by seq. The stream ends after the `end` event, or after about
 * 280 s (reconnect with `after`). Another Owner's Run is a 404 before the
 * first line.
 */
export const GET = sieveApi
  .use(params(runPathSchema))
  .use(query(eventsQuerySchema))
  .handle(async ({ services, owner, path, query, request }) =>
    ndjson<StoredEvent>(
      await services.runs.follow(
        owner,
        path.runId,
        query.after,
        request.signal,
      ),
      { scope: "name-extraction", signal: request.signal },
    ),
  );
