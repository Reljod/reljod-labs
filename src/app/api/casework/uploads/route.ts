import {
  type UploadSlot,
  uploadRequestSchema,
} from "@/features/casework/domain/api";
import { caseworkApi, withDesk } from "@/features/casework/server/api";
import { body } from "@/platform/http/middleware";

/**
 * Signed slots to upload dropped files straight to Storage, one per file (or
 * why it was left out), each with a ticket to record it by afterwards.
 */
export const POST = caseworkApi
  .use(body(uploadRequestSchema))
  .use(withDesk({ create: true }))
  .handle(
    ({ services, desk, body }): Promise<UploadSlot[]> =>
      services.uploads.begin(desk, body.files),
  );
