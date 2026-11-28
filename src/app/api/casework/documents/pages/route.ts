import {
  type DocumentPagesResponse,
  documentPagesQuerySchema,
} from "@/features/casework/domain/api";
import { caseworkApi } from "@/features/casework/server/api";
import { query } from "@/platform/http/middleware";

/**
 * Signed page images for several Documents in one request
 * (`?ids=<id>,<id>`): the Cabinet's, or the open Desk's own uploads (none
 * before the Owner has a Desk), never another Desk's. `no-store`: the answer
 * holds signed links to an Owner's uploads.
 */
export const GET = caseworkApi
  .use(query(documentPagesQuerySchema))
  .handle(
    ({
      services,
      owner,
      rememberedId,
      query,
    }): Promise<DocumentPagesResponse> =>
      services.desks.pages(owner, rememberedId, query.ids),
  );
