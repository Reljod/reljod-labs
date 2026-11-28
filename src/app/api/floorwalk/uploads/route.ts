import { uploadRequestSchema } from "@/features/floorwalk/domain/api";
import { floorwalkApi } from "@/features/floorwalk/server/api";
import { body } from "@/platform/http/middleware";

/**
 * A one-time upload URL for the visitor's own footage, in their Owner's
 * folder. The video goes straight to the private bucket; the Walk reads it
 * back and checks its type, size and length again before the model.
 */
export const POST = floorwalkApi
  .use(body(uploadRequestSchema))
  .handle(({ services, owner, visitor, body }) =>
    services.prepareUpload({ owner, visitor }, body),
  );
