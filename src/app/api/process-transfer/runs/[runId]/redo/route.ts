import {
  runParamsSchema,
  type StartedResponse,
} from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";
import { params } from "@/platform/http/middleware";

/** Design, Check and Approve again on a finished Run, under the Owner's current Rules and models. */
export const POST = handoverApi.use(params(runParamsSchema)).handle(
  async ({ services, owner, visitor, path }): Promise<StartedResponse> => ({
    runId: await services.runs.redo({ owner, visitor }, path.runId),
  }),
);
