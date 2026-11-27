import { z } from "zod";
import type { ManifestSummary } from "@/features/operator/domain/contract";
import { operatorApi } from "@/features/operator/server/api";
import { params } from "@/platform/http/middleware";

/** Reads an uploaded Manifest (CSV or PDF) into rows. Call after the upload finished. */
export const POST = operatorApi
  .use(params(z.object({ manifestId: z.string().max(64) })))
  .handle(
    ({ services, owner, path }): Promise<ManifestSummary> =>
      services.manifests.read(owner, path.manifestId),
  );
