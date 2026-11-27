import type { EmployerListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";

/** The plan's Employers, by name. */
export const GET = harnessApi.handle(
  async ({ services, caller }): Promise<EmployerListResponse> => ({
    employers: await services.records.employers(caller),
  }),
);
