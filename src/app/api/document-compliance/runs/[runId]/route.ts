import {
  type RunResponse,
  runPathSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { params } from "@/platform/http/middleware";

/** One of the Owner's runs, whole; another Owner's run is not found. */
export const GET = documentComplianceApi
  .use(params(runPathSchema))
  .handle(
    ({ services, owner, path }): Promise<RunResponse> =>
      services.runs.get(owner, path.runId),
  );
