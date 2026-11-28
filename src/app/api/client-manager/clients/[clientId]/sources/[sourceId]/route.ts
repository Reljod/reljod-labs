import { sourceParamsSchema } from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { params } from "@/platform/http/middleware";

/**
 * A document as it was read, a link to the original, and every fact that
 * quotes it. Never kept, even for a Sample: `url` is a signed link.
 */
export const GET = clientManagerApi
  .use(params(sourceParamsSchema))
  .handle(({ services, owner, path }) =>
    services.clients.source(owner, path.clientId, path.sourceId),
  );
