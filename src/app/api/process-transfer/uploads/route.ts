import { uploadRequestSchema } from "@/features/process-transfer/domain/api";
import type { UploadTicket } from "@/features/process-transfer/domain/run";
import { handoverApi } from "@/features/process-transfer/server/api";
import { body } from "@/platform/http/middleware";

/**
 * A one-time upload URL for a Recording, under the Owner's own folder. The
 * video goes straight to the private bucket; starting a Run checks it is
 * there and small enough, and the Watch reads its length before any model.
 */
export const POST = handoverApi
  .use(body(uploadRequestSchema))
  .handle(
    ({ services, owner, visitor, body }): Promise<UploadTicket> =>
      services.runs.prepareUpload({ owner, visitor }, body),
  );
