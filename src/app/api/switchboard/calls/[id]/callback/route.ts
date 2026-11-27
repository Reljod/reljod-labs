import { callPath, switchboardApi } from "@/features/switchboard/server/api";
import { params } from "@/platform/http/middleware";

/** Wakes a Call's Workflow from its Callback sleep now, instead of at the promised time. */
export const POST = switchboardApi
  .use(params(callPath))
  .handle(({ services, owner, path }) =>
    services.calls.callbackNow(owner, path.id),
  );
