import {
  type ManifestListResponse,
  type ManifestUploadSlot,
  manifestUploadSchema,
} from "@/features/operator/domain/api";
import { operatorApi } from "@/features/operator/server/api";
import { body } from "@/platform/http/middleware";

/** The Manifests the Owner attached and the server could read, newest first. */
export const GET = operatorApi.handle(
  ({ services, owner }): Promise<ManifestListResponse> =>
    services.manifests.list(owner),
);

/**
 * Opens a Manifest upload: a row and a signed URL the browser PUTs the file
 * to. Then `manifests/[manifestId]/read` reads it into rows.
 */
export const POST = operatorApi
  .use(body(manifestUploadSchema))
  .handle(
    ({ services, owner, visitor, body }): Promise<ManifestUploadSlot> =>
      services.manifests.openUpload({ owner, visitor }, body),
  );
