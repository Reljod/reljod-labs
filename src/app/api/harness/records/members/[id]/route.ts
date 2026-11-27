import type { MemberResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { params } from "@/platform/http/middleware";

/** A Member, by id or member number, with their Employer and Member requests. */
export const GET = harnessApi
  .use(params(idSchema))
  .handle(
    ({ services, caller, path }): Promise<MemberResponse> =>
      services.records.member(caller, path.id),
  );
