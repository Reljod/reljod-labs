import type { EmployerResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { params } from "@/platform/http/middleware";

/** An Employer, by id or code, with its Schedules. */
export const GET = harnessApi
  .use(params(idSchema))
  .handle(
    ({ services, caller, path }): Promise<EmployerResponse> =>
      services.records.employer(caller, path.id),
  );
