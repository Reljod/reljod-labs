import { editRequestSchema } from "@/features/helio/domain/schemas";
import { HELIO_BODY_LIMIT, helioApi } from "@/features/helio/server/api";
import { body } from "@/platform/http/middleware";

export const maxDuration = 60;

/** A surgical edit of one campaign frame: every image is checked and the cap taken before the model. */
export const POST = helioApi
  .use(body(editRequestSchema, { limit: HELIO_BODY_LIMIT }))
  .handle(({ services, visitor, body }) => services.edit(visitor, body));
