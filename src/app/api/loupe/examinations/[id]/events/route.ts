import { eventsQuerySchema } from "@/features/loupe/domain/api";
import type { StoredEvent } from "@/features/loupe/domain/contract";
import { examinationPath, loupeApi } from "@/features/loupe/server/api";
import { params, query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the Examination streams; the client reconnects with `after`.
export const maxDuration = 300;

/**
 * Streams an Examination's Trail as newline-delimited JSON, one
 * `StoredEvent` per line, to its Owner. `?after=<seq>` resumes after the
 * last event the client has. The stream ends after the `end` event, or
 * after about 280 s (reconnect with `after`). An Examination that is not the
 * Owner's is a 404 before the first line.
 */
export const GET = loupeApi
  .use(params(examinationPath))
  .use(query(eventsQuerySchema))
  .handle(async ({ services, owner, path, query, request }) =>
    ndjson<StoredEvent>(
      await services.examinations.follow(
        owner,
        path.id,
        query.after,
        request.signal,
      ),
      { scope: "loupe", signal: request.signal },
    ),
  );
