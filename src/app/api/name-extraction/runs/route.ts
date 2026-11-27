import {
  type RunListResponse,
  type StartRunResponse,
  startRunSchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's Runs, newest first. */
export const GET = sieveApi.handle(
  ({ services, owner }): Promise<RunListResponse> => services.runs.list(owner),
);

/**
 * Starts a Run over a Corpus Document or one of the Owner's Uploads, under
 * the caps; the workflow runs it. Answers at once with its id.
 */
export const POST = sieveApi
  .use(body(startRunSchema))
  .handle(
    ({ services, caller, body }): Promise<StartRunResponse> =>
      services.runs.start(caller, body),
  );
