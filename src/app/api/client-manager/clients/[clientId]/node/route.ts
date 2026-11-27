import {
  clientParamsSchema,
  type NodeResponse,
  nodeQuerySchema,
} from "@/features/client-manager/domain/api";
import { clientManagerApi } from "@/features/client-manager/server/api";
import { params, query } from "@/platform/http/middleware";
import { CACHE, json } from "@/platform/http/respond";

/** One fact in full: its quotes, and every relation with its own quotes. */
export const GET = clientManagerApi
  .use(params(clientParamsSchema))
  .use(query(nodeQuerySchema))
  .handle(async ({ services, owner, path, query, request }) => {
    const { node, shared } = await services.clients.node(
      owner,
      path.clientId,
      query.key,
    );
    return json<NodeResponse>(node, {
      cache: shared ? CACHE.seed : CACHE.none,
      request,
    });
  });
