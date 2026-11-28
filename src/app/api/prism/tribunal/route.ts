import {
  type TribunalStreamEvent,
  tribunalRequestSchema,
} from "@/features/prism/domain/api";
import { prismApi } from "@/features/prism/server/api";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

/**
 * A Tribunal: every Juror over the same Slip at once, each answer streamed
 * as NDJSON as it lands. The cap (one call per Juror) is taken before the
 * stream starts, so a refusal is still a JSON error.
 */
export const POST = prismApi
  .use(body(tribunalRequestSchema))
  .handle(async ({ services, owner, visitor, body, request }) =>
    ndjson<TribunalStreamEvent>(
      await services.tribunal({ owner, visitor }, body, request.signal),
      { scope: "prism", signal: request.signal },
    ),
  );
