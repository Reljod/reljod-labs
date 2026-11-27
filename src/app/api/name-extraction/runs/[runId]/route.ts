import {
  type RunResponse,
  runPathSchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { params } from "@/platform/http/middleware";

/** One of the Owner's Runs with its Audit trail and its Register; 404 if not theirs. */
export const GET = sieveApi
  .use(params(runPathSchema))
  .handle(
    ({ services, owner, path }): Promise<RunResponse> =>
      services.runs.detail(owner, path.runId),
  );
