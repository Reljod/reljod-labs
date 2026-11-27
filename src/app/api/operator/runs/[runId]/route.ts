import type { RunResponse } from "@/features/operator/domain/api";
import { operatorApi, runParams } from "@/features/operator/server/api";

/** One of the Owner's Runs with its Trail and Findings; 404 if not theirs. */
export const GET = operatorApi
  .use(runParams())
  .handle(
    ({ services, owner, path }): Promise<RunResponse> =>
      services.runs.detail(owner, path.runId),
  );
