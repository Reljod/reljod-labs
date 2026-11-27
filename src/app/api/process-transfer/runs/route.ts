import {
  type StartedResponse,
  startRequestSchema,
} from "@/features/process-transfer/domain/api";
import { handoverApi, hostOf } from "@/features/process-transfer/server/api";
import { body } from "@/platform/http/middleware";

/** Starts a Run on a Sample or on the Owner's own upload, once the caps allow it. */
export const POST = handoverApi.use(body(startRequestSchema)).handle(
  async ({
    services,
    owner,
    visitor,
    body,
    request,
  }): Promise<StartedResponse> => ({
    runId: await services.runs.start({ owner, visitor }, body, hostOf(request)),
  }),
);
