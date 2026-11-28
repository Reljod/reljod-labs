import {
  type OverviewResponse,
  overviewQuerySchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { query } from "@/platform/http/middleware";

/**
 * A Document's title, page count, names per page and every name:
 * `?corpus=<id>` or `?upload=<uuid>`, or `?run=<id>` for that Run's own
 * Document and Names.
 */
export const GET = sieveApi
  .use(query(overviewQuerySchema))
  .handle(
    ({ services, owner, query }): Promise<OverviewResponse> =>
      services.preview.overview(owner, query),
  );
