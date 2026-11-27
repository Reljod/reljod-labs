import { buildParamsSchema } from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { params } from "@/platform/http/middleware";

/** Stops a running Build (the Stop button, Escape): the client's Owner only. */
export const POST = clientManagerApi
  .use(params(buildParamsSchema))
  .handle(({ services, caller, path }) =>
    services.builds.stop(caller, path.buildId),
  );
