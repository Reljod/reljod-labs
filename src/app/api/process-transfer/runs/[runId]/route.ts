import {
  type RunResponse,
  runParamsSchema,
} from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";
import { params } from "@/platform/http/middleware";

/** One of this Owner's Runs. Another Owner's Run is "not found", like a missing one. */
export const GET = handoverApi.use(params(runParamsSchema)).handle(
  async ({ services, owner, path }): Promise<RunResponse> => ({
    run: await services.runs.run(owner, path.runId),
  }),
);
