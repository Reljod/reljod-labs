import {
  reviewSchema,
  runPathSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { body, params } from "@/platform/http/middleware";

/** A Reviewer's decision on a flagged Finding of the run's latest Evaluation (204). */
export const POST = documentComplianceApi
  .use(params(runPathSchema))
  .use(body(reviewSchema))
  .handle(({ services, caller, path, body }) =>
    services.runs.review(caller, path.runId, body),
  );
