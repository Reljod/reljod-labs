import {
  type TrailResponse,
  trailQuerySchema,
} from "@/features/canvas/domain/api";
import { canvasApi } from "@/features/canvas/server/api";
import { query } from "@/platform/http/middleware";

/** A page of the Owner's Trail, newest first; `?conversationId=`, `?viewId=`, `?before=`. */
export const GET = canvasApi.use(query(trailQuerySchema)).handle(
  async ({ services, owner, query }): Promise<TrailResponse> => ({
    events: await services.trail.list(owner, query),
  }),
);
