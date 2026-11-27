import {
  runParamsSchema,
  type StopResponse,
} from "@/features/casework/domain/api";
import { caseworkApi, withDesk } from "@/features/casework/server/api";
import { params } from "@/platform/http/middleware";

/** Stops one Run of the open Desk; 404 for a Run of any other Desk. */
export const POST = caseworkApi
  .use(params(runParamsSchema))
  .use(withDesk({ create: false }))
  .handle(
    ({ services, desk, path }): Promise<StopResponse> =>
      services.runs.stop(desk, path.runId),
  );
