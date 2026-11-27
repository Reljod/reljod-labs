import { passParamsSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { params } from "@/platform/http/middleware";

/** A Host ends a live pass now: every Guest on it loses Access at once. */
export const POST = hostApi
  .use(params(passParamsSchema))
  .handle(({ services, access, path }) =>
    services.guestPasses.revoke(access, path.id),
  );
