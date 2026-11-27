import { z } from "zod";
import type { MemberRequestListResponse } from "@/features/harness/domain/api";
import { MEMBER_REQUEST_KINDS } from "@/features/harness/domain/records";
import { harnessApi } from "@/features/harness/server/api";
import { query } from "@/platform/http/middleware";

const schema = z.object({
  // An unknown kind lists every kind, as it always has.
  kind: z.enum(MEMBER_REQUEST_KINDS).optional().catch(undefined),
  member: z.string().max(200).optional(),
});

/** Member requests, newest first; `?kind=` and `?member=` narrow them. */
export const GET = harnessApi.use(query(schema)).handle(
  async ({ services, caller, query }): Promise<MemberRequestListResponse> => ({
    requests: await services.records.memberRequests(caller, {
      kind: query.kind ?? null,
      memberId: query.member ?? null,
    }),
  }),
);
