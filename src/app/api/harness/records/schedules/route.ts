import { z } from "zod";
import type { ScheduleListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";
import { query } from "@/platform/http/middleware";

const schema = z.object({
  employer: z.string().max(200).optional(),
  period: z.string().max(20).optional(),
});

/** Schedules with their lines, newest month first; `?employer=` for one Employer's. */
export const GET = harnessApi.use(query(schema)).handle(
  async ({ services, caller, query }): Promise<ScheduleListResponse> => ({
    schedules: await services.records.schedules(caller, {
      employerId: query.employer ?? null,
      period: query.period ?? null,
    }),
  }),
);
