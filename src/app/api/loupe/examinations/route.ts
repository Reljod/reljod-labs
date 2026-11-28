import {
  type ExaminationListResponse,
  type StartResponse,
  startRequestSchema,
} from "@/features/loupe/domain/api";
import { loupeApi } from "@/features/loupe/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's Examinations, newest first. */
export const GET = loupeApi.handle(
  ({ services, owner }): Promise<ExaminationListResponse> =>
    services.examinations.list(owner),
);

/**
 * Starts an Examination of a Sample or of one of the Owner's Uploads, under
 * the limits; the workflow runs it. Answers at once with its id.
 */
export const POST = loupeApi
  .use(body(startRequestSchema))
  .handle(
    ({ services, who, body }): Promise<StartResponse> =>
      services.examinations.start(who, body),
  );
