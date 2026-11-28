import {
  type ReportResponse,
  reportSchema,
} from "@/features/switchboard/domain/api";
import { callPath, switchboardApi } from "@/features/switchboard/server/api";
import { body, params } from "@/platform/http/middleware";

/** What the browser heard and measured in a voice Call (`reportedEventSchema`). */
export const POST = switchboardApi
  .use(params(callPath))
  .use(body(reportSchema))
  .handle(
    ({ services, caller, path, body }): Promise<ReportResponse> =>
      services.calls.report(caller, path.id, body.events),
  );
