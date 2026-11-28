import { z } from "zod";
import type { ConflictListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";
import { query } from "@/platform/http/middleware";

const schema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
});

/** The Workspace's Conflicts, open first. `?status=open` or `resolved` narrows them. */
export const GET = harnessApi.use(query(schema)).handle(
  async ({ services, caller, query }): Promise<ConflictListResponse> => ({
    conflicts: await services.knowledge.conflicts(caller, {
      status: query.status ?? null,
    }),
  }),
);
