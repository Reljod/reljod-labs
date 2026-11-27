import {
  type CallsResponse,
  type StartCallResponse,
  startCallSchema,
} from "@/features/switchboard/domain/api";
import { switchboardApi } from "@/features/switchboard/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's saved Calls, newest first. */
export const GET = switchboardApi.handle(
  async ({ services, owner }): Promise<CallsResponse> => ({
    calls: await services.calls.list(owner),
  }),
);

/**
 * Starts a Call. The voice Line answers with what opens the realtime
 * Session; the text Line with the Agent's greeting already said.
 */
export const POST = switchboardApi
  .use(body(startCallSchema))
  .handle(
    ({ services, caller, body }): Promise<StartCallResponse> =>
      services.calls.start(caller, { ...body, origin: "app" }),
  );
