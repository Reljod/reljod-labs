import { buildParamsSchema } from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { params } from "@/platform/http/middleware";

/** Starts a Build's workflow, once its files are uploaded: the client's Owner only. */
export const POST = clientManagerApi
  .use(params(buildParamsSchema))
  .handle(({ services, caller, path }) =>
    services.builds.start(caller, path.buildId),
  );
