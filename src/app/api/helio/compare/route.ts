import { compareRequestSchema } from "@/features/helio/domain/schemas";
import type { CompareStreamEvent } from "@/features/helio/domain/types";
import { HELIO_BODY_LIMIT, helioApi } from "@/features/helio/server/api";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

export const maxDuration = 120;

/**
 * Flash against Flagship on one market, streamed as NDJSON. The cap (two
 * images) is taken before the stream starts.
 */
export const POST = helioApi
  .use(body(compareRequestSchema, { limit: HELIO_BODY_LIMIT }))
  .handle(async ({ services, visitor, body, request }) =>
    ndjson<CompareStreamEvent>(await services.compare(visitor, body), {
      scope: "helio",
      signal: request.signal,
    }),
  );
