import {
  type CascadeStreamEvent,
  cascadeRequestSchema,
} from "@/features/prism/domain/api";
import { prismApi } from "@/features/prism/server/api";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

/**
 * A Cascade: a batch of Slips sorted a few at a time, each streamed as
 * NDJSON as it is decided. The cap (one call per Slip) is taken before the
 * stream starts, so a refusal is still a JSON error.
 */
export const POST = prismApi
  .use(body(cascadeRequestSchema))
  .handle(async ({ services, owner, visitor, body, request }) =>
    ndjson<CascadeStreamEvent>(
      await services.cascade({ owner, visitor }, body, request.signal),
      { scope: "prism", signal: request.signal },
    ),
  );
