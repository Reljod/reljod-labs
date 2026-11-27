import {
  type ComparisonResponse,
  runPathSchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { params } from "@/platform/http/middleware";

/** One of the Owner's Runs set against the answer key, row by row. */
export const GET = sieveApi
  .use(params(runPathSchema))
  .handle(
    ({ services, owner, path }): Promise<ComparisonResponse> =>
      services.preview.comparison(owner, path.runId),
  );
