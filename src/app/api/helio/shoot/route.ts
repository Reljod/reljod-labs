import { shootRequestSchema } from "@/features/helio/domain/schemas";
import type { ShootStreamEvent } from "@/features/helio/domain/types";
import { HELIO_BODY_LIMIT, helioApi } from "@/features/helio/server/api";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

export const maxDuration = 120;

/**
 * A campaign Shoot: Neon directs, then MAI shoots every market in parallel,
 * streamed as NDJSON. The images are checked and both caps (one director
 * call, one image per market) taken together before the stream starts, so a
 * refusal is still a JSON error.
 */
export const POST = helioApi
  .use(body(shootRequestSchema, { limit: HELIO_BODY_LIMIT }))
  .handle(async ({ services, visitor, body, request }) =>
    ndjson<ShootStreamEvent>(await services.shoot(visitor, body), {
      scope: "helio",
      signal: request.signal,
    }),
  );
