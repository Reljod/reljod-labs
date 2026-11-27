import { passParamsSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { params } from "@/platform/http/middleware";

/**
 * A Host deletes a pass: its Guests lose Access at once, and the pass and
 * what they saved are purged after `LIMITS.retentionDays` unless restored.
 */
export const DELETE = hostApi
  .use(params(passParamsSchema))
  .handle(({ services, access, path }) =>
    services.guestPasses.remove(access, path.id),
  );
