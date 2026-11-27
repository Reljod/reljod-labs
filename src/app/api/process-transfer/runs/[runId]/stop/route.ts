import { runParamsSchema } from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";
import { params } from "@/platform/http/middleware";

/** Stops the Run: the row is marked first and always, the workflow cancelled on a best-effort basis. */
export const POST = handoverApi
  .use(params(runParamsSchema))
  .handle(({ services, owner, path }) => services.runs.stop(owner, path.runId));
