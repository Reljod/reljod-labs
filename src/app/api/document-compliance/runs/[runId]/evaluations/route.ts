import {
  type ReevaluateResponse,
  runPathSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { params } from "@/platform/http/middleware";
import { json } from "@/platform/http/respond";

/**
 * Evaluates a finished run again with the Owner's current Rules, in code over
 * the stored readings (no model is called), as the run's next Evaluation.
 */
export const POST = documentComplianceApi
  .use(params(runPathSchema))
  .handle(async ({ services, caller, path }) =>
    json<ReevaluateResponse>(
      await services.runs.reevaluate(caller, path.runId),
      { status: 201 },
    ),
  );
