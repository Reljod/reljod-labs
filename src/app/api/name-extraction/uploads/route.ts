import {
  type CreateUploadResponse,
  createUploadSchema,
} from "@/features/name-extraction/domain/api";
import { sieveApi } from "@/features/name-extraction/server/api";
import { body } from "@/platform/http/middleware";

/**
 * Opens an Upload: a row and a signed URL the browser PUTs the pages to, as
 * JSON `{ pages: string[] }`. The pages never pass through here; a Run
 * checks them when it loads them. Capped per Owner per day.
 */
export const POST = sieveApi
  .use(body(createUploadSchema))
  .handle(
    ({ services, caller, body }): Promise<CreateUploadResponse> =>
      services.uploads.create(caller, body),
  );
