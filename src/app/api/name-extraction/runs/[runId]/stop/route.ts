import {
  runPathSchema,
  type StopRunResponse,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { params } from "@/platform/http/middleware";

/** Stops one of the Owner's Runs. Never asks first: it is the escape hatch. */
export const POST = sieveApi
  .use(params(runPathSchema))
  .handle(
    ({ services, owner, path }): Promise<StopRunResponse> =>
      services.runs.stop(owner, path.runId),
  );
