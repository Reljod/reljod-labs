import {
  type CallResponse,
  callQuerySchema,
} from "@/features/switchboard/domain/api";
import { callPath, switchboardApi } from "@/features/switchboard/server/api";
import { params, query } from "@/platform/http/middleware";

/** One Call with its Events; `?after=<event id>` for only what is new. */
export const GET = switchboardApi
  .use(params(callPath))
  .use(query(callQuerySchema))
  .handle(
    ({ services, owner, path, query }): Promise<CallResponse> =>
      services.calls.get(owner, path.id, query.after),
  );
