import type { Allowance } from "@/features/floorwalk/domain/api";
import { floorwalkApi } from "@/features/floorwalk/server/api";

/** How many Walks and questions the visitor has left this hour. */
export const GET = floorwalkApi.handle(
  ({ services, visitor }): Promise<Allowance> => services.allowance(visitor),
);
