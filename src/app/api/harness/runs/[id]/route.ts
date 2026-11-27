import type { RunResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { params } from "@/platform/http/middleware";

/** A Run with its Steps, Findings, Approvals and Drafts. */
export const GET = harnessApi.use(params(idSchema)).handle(
  async ({ services, caller, path }): Promise<RunResponse> => ({
    run: await services.runs.get(caller, path.id),
  }),
);
