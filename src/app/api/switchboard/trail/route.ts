import {
  type TrailResponse,
  trailQuerySchema,
} from "@/features/switchboard/domain/api";
import { switchboardApi } from "@/features/switchboard/server/api";
import { query } from "@/platform/http/middleware";

/** The Workspace's append-only trail, newest first; `?before=<event id>` for older. */
export const GET = switchboardApi.use(query(trailQuerySchema)).handle(
  async ({ services, owner, query }): Promise<TrailResponse> => ({
    events: await services.office.trail(owner, query.before),
  }),
);
