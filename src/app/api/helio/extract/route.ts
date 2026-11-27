import { extractRequestSchema } from "@/features/helio/domain/schemas";
import { HELIO_BODY_LIMIT, helioApi } from "@/features/helio/server/api";
import { body } from "@/platform/http/middleware";

export const maxDuration = 60;

/** An RGBA product plate: the image is checked and the cap taken before the model. */
export const POST = helioApi
  .use(body(extractRequestSchema, { limit: HELIO_BODY_LIMIT }))
  .handle(({ services, visitor, body }) => services.extract(visitor, body));
