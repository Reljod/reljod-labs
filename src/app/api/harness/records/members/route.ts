import { z } from "zod";
import type { MemberListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";
import { query } from "@/platform/http/middleware";

const schema = z.object({
  q: z.string().max(200).default(""),
  employer: z.string().max(200).optional(),
});

/** Members whose name or number matches `?q=`, optionally of one `?employer=`. */
export const GET = harnessApi.use(query(schema)).handle(
  async ({ services, caller, query }): Promise<MemberListResponse> => ({
    members: await services.records.members(caller, {
      q: query.q,
      employerId: query.employer ?? null,
    }),
  }),
);
