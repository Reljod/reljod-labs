import type { StoppedRun } from "@/features/operator/domain/api";
import { operatorApi, runParams } from "@/features/operator/server/api";

/** Stops one of the Owner's Runs and removes its sandboxes. Never asks first: it is the escape hatch. */
export const POST = operatorApi
  .use(runParams())
  .handle(
    ({ services, owner, path }): Promise<StoppedRun> =>
      services.runs.stop(owner, path.runId),
  );
