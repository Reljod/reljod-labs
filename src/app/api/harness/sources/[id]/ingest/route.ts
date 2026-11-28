import type { SourceIngestResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, params } from "@/platform/http/middleware";

/** Reading a Source embeds its Passages and asks the model about Conflicts: it can take a while. */
export const maxDuration = 60;

/** Files an uploaded Source: Passages, embeddings, a Conflict check. Safe to call again. */
export const POST = harnessApi
  .use(authorize(permits("source.add")))
  .use(params(idSchema))
  .handle(
    ({ services, caller, path }): Promise<SourceIngestResponse> =>
      services.knowledge.ingest(caller, path.id),
  );
