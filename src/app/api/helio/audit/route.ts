import { auditRequestSchema } from "@/features/helio/domain/schemas";
import { HELIO_BODY_LIMIT, helioApi } from "@/features/helio/server/api";
import { body } from "@/platform/http/middleware";

export const maxDuration = 60;

/** A brand-integrity audit of a staged frame: images checked and the cap taken before Neon. */
export const POST = helioApi
  .use(body(auditRequestSchema, { limit: HELIO_BODY_LIMIT }))
  .handle(({ services, visitor, body }) => services.audit(visitor, body));
