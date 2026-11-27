import type { CallResponse } from "@/features/switchboard/domain/api";
import { callPath, switchboardApi } from "@/features/switchboard/server/api";
import { params } from "@/platform/http/middleware";

/** Hangs up. The Call's Workflow wakes and writes the Wrap-up. */
export const POST = switchboardApi
  .use(params(callPath))
  .handle(
    ({ services, caller, path }): Promise<CallResponse> =>
      services.calls.end(caller, path.id, "caller"),
  );
