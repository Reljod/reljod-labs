import {
  type WalkEvent,
  walkRequestSchema,
} from "@/features/floorwalk/domain/api";
import { floorwalkApi } from "@/features/floorwalk/server/api";
import { body } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

export const maxDuration = 300;

/**
 * One Walk: the Walker watches the footage and its checked Sightings stream
 * back as NDJSON. The service checks the upload's owner and takes the rate
 * before it reads the footage, so a refusal is still a JSON error; after the
 * first line, a failure is an `error` line in the stream.
 */
export const POST = floorwalkApi
  .use(body(walkRequestSchema))
  .handle(async ({ services, owner, visitor, body, request }) =>
    ndjson<WalkEvent>(
      await services.walk({ owner, visitor }, body.source, {
        origin: new URL(request.url).origin,
        signal: request.signal,
      }),
      {
        scope: "floorwalk",
        signal: request.signal,
        onError: () => ({
          t: "error",
          message: "The Walker stopped partway. Try the Walk again.",
        }),
      },
    ),
  );
