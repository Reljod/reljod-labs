import type {
  SourceRemoveResponse,
  SourceResponse,
} from "@/features/harness/domain/api";
import { harnessApi, idSchema, permits } from "@/features/harness/server/api";
import { authorize, params } from "@/platform/http/middleware";

/** One Source with its Passages in order, superseded ones marked. */
export const GET = harnessApi
  .use(params(idSchema))
  .handle(
    ({ services, caller, path }): Promise<SourceResponse> =>
      services.knowledge.source(caller, path.id),
  );

/** Removes a Source that is not a seed (admin). Soft: purged 30 days later. */
export const DELETE = harnessApi
  .use(authorize(permits("source.remove")))
  .use(params(idSchema))
  .handle(async ({ services, caller, path }): Promise<SourceRemoveResponse> => {
    await services.knowledge.remove(caller, path.id);
    return { removed: true };
  });
