import {
  type PagesResponse,
  pagesQuerySchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { query } from "@/platform/http/middleware";

/**
 * Pages `from` to `to` (1-based, inclusive, at most `LIMITS.previewPages`)
 * with their marks: the overview's query plus `&from=&to=`. The 500-page
 * preview asks for its chunks in parallel; each answer carries an ETag, so a
 * chunk read again costs a 304.
 */
export const GET = sieveApi
  .use(query(pagesQuerySchema))
  .handle(
    ({ services, owner, query }): Promise<PagesResponse> =>
      services.preview.pages(owner, query),
  );
