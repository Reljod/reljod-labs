import type { StopResponse } from "@/features/loupe/domain/api";
import { examinationPath, loupeApi } from "@/features/loupe/server/api";
import { params } from "@/platform/http/middleware";

/** Stops one of the Owner's Examinations. Never asks first: it is the escape hatch. */
export const POST = loupeApi
  .use(params(examinationPath))
  .handle(
    ({ services, who, path }): Promise<StopResponse> =>
      services.examinations.stop(who, path.id),
  );
