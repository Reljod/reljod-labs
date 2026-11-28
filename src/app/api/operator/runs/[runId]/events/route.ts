import { z } from "zod";
import type { RunEvent } from "@/features/operator/domain/contract";
import { operatorApi, runParams } from "@/features/operator/server/api";
import { query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the Run streams; the client reconnects with `after`.
export const maxDuration = 300;

/**
 * Streams a Run's Trail as newline-delimited JSON, one `RunEvent` per line,
 * to the Owner of the Run. `?after=<seq>` resumes after the last event the
 * client has (0 for none; seqs start at 1). Each poll also reads back a few
 * seqs behind the cursor for events that committed late, so the client may
 * get an event it already has and dedupes by seq. The stream ends after the
 * `end` event, or after about 280 s (reconnect with `after`).
 */
export const GET = operatorApi
  .use(runParams())
  .use(query(z.object({ after: z.coerce.number().min(0).catch(0) })))
  .handle(async ({ services, owner, path, query, request }) =>
    ndjson<RunEvent>(
      await services.runs.follow(
        owner,
        path.runId,
        query.after,
        request.signal,
      ),
      { scope: "operator", signal: request.signal },
    ),
  );
