import {
  clientParamsSchema,
  type EdgesResponse,
  edgesQuerySchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { params, query } from "@/platform/http/middleware";
import { CACHE, json } from "@/platform/http/respond";

/** The relations one part of the Map needs; the Map asks for more as you open things. */
export const GET = clientManagerApi
  .use(params(clientParamsSchema))
  .use(query(edgesQuerySchema))
  .handle(async ({ services, owner, path, query, request }) => {
    const { edges, shared } = await services.clients.edges(
      owner,
      path.clientId,
      query.scope,
    );
    return json<EdgesResponse>(
      { edges },
      { cache: shared ? CACHE.seed : CACHE.none, request },
    );
  });
