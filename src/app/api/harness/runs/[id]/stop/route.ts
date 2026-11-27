import type { RunResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, params } from "@/platform/http/middleware";

/** Stops a Run. Always works, whatever state the workflow is in. */
export const POST = harnessApi
  .use(authorize(permits("run.stop")))
  .use(params(idSchema))
  .handle(
    async ({ services, caller, path }): Promise<RunResponse> => ({
      run: await services.runs.stop(caller, path.id),
    }),
  );
