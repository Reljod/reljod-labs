import type { DeskResponse } from "@/features/process-transfer/domain/api";
import { handoverApi } from "@/features/process-transfer/server/api";

/** The Desk: this Owner's Runs, Rules, models and spend, in one read. */
export const GET = handoverApi.handle(
  async ({ services, owner, visitor }): Promise<DeskResponse> => ({
    desk: await services.runs.desk({ owner, visitor }),
  }),
);
