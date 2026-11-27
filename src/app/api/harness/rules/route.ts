import { z } from "zod";
import type { RuleListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";
import { query } from "@/platform/http/middleware";

const schema = z.object({ pipeline: z.string().max(64).optional() });

/** Rules as the Workspace has them; `?pipeline=` for one Rulebook's. */
export const GET = harnessApi.use(query(schema)).handle(
  async ({ services, caller, query }): Promise<RuleListResponse> => ({
    rules: await services.rules.list(caller, query.pipeline ?? null),
  }),
);
