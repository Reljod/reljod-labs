import type { ExaminationResponse } from "@/features/loupe/domain/api";
import { examinationPath, loupeApi } from "@/features/loupe/server/api";
import { params } from "@/platform/http/middleware";

/** One of the Owner's Examinations with its Trail, Measurements and Findings. */
export const GET = loupeApi
  .use(params(examinationPath))
  .handle(
    ({ services, owner, path }): Promise<ExaminationResponse> =>
      services.examinations.detail(owner, path.id),
  );
