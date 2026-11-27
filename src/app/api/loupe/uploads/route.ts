import {
  type UploadListResponse,
  type UploadResponse,
  uploadRequestSchema,
} from "@/features/loupe/domain/api";
import { loupeApi } from "@/features/loupe/server/api";
import { body } from "@/platform/http/middleware";

/** The Owner's Uploads, newest first. */
export const GET = loupeApi.handle(
  ({ services, owner }): Promise<UploadListResponse> =>
    services.uploads.list(owner),
);

/**
 * Opens an Upload (or a Forgery from the bench): a row and a signed URL the
 * browser PUTs the file to. The bytes never pass through here.
 */
export const POST = loupeApi
  .use(body(uploadRequestSchema))
  .handle(
    ({ services, who, body }): Promise<UploadResponse> =>
      services.uploads.open(who, body),
  );
