import type { SourcePreviewResponse } from "@/features/harness/domain/api";
import { harnessApi, idSchema } from "@/features/harness/server/api";
import { params } from "@/platform/http/middleware";

/**
 * A Source to read raw: its extracted text and a 5-minute signed link to its
 * file. Owner-scoped, like every Source route; the read is audited.
 */
export const GET = harnessApi
  .use(params(idSchema))
  .handle(
    ({ services, caller, path }): Promise<SourcePreviewResponse> =>
      services.knowledge.preview(caller, path.id),
  );
