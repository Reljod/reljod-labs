import type { SourceListResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";

/** The Knowledge base's Sources: newest first, seed Sources after. */
export const GET = harnessApi.handle(
  async ({ services, caller }): Promise<SourceListResponse> => ({
    sources: await services.knowledge.sources(caller),
  }),
);
