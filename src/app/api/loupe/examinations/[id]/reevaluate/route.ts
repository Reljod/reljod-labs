import type { ReevaluateResponse } from "@/features/loupe/domain/api";
import { examinationPath, loupeApi } from "@/features/loupe/server/api";
import { params } from "@/platform/http/middleware";

/** Decides a completed Examination again under the Owner's current Rulebook. No model call. */
export const POST = loupeApi
  .use(params(examinationPath))
  .handle(
    ({ services, who, path }): Promise<ReevaluateResponse> =>
      services.examinations.reevaluate(who, path.id),
  );
