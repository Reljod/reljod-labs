import {
  buildEventsQuerySchema,
  buildParamsSchema,
} from "@/features/client-manager/domain/api";
import type { BuildEvent } from "@/features/client-manager/domain/events";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { params, query } from "@/platform/http/middleware";
import { ndjson } from "@/platform/http/respond";

// Stays open while the Build streams; a reconnect resumes from `from`.
export const maxDuration = 300;

/** A Build's events as NDJSON, from the `from`th on, to an Owner who may see its client. */
export const GET = clientManagerApi
  .use(params(buildParamsSchema))
  .use(query(buildEventsQuerySchema))
  .handle(async ({ services, owner, path, query, request }) =>
    ndjson<BuildEvent>(
      await services.builds.events(owner, path.buildId, query.from),
      { scope: "client-manager", signal: request.signal },
    ),
  );
