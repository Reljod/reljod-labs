import {
  type RunListResponse,
  startRunSchema,
} from "@/features/document-compliance/domain/api";
import { documentComplianceApi } from "@/features/document-compliance/server/api";
import { body } from "@/platform/http/middleware";
import { json } from "@/platform/http/respond";

/** The runs this Owner started, newest first, on any device. */
export const GET = documentComplianceApi.handle(
  ({ services, owner }): Promise<RunListResponse> => services.runs.list(owner),
);

/**
 * Starts a Pre-screen of a preset pack. The caps are taken with the run's
 * insert, before anything is paid for; a refusal is a 429 carrying `runId`,
 * the latest stored run of the pack to show instead.
 */
export const POST = documentComplianceApi
  .use(body(startRunSchema))
  .handle(async ({ services, caller, body }) =>
    json(await services.runs.start(caller, body.packSlug), { status: 201 }),
  );
