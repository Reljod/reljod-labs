import { extendSchema, passParamsSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { body, params } from "@/platform/http/middleware";

/** A Host extends a live pass, or renews one that ended. */
export const POST = hostApi
  .use(params(passParamsSchema))
  .use(body(extendSchema, { limit: 1024 }))
  .handle(({ services, access, path, body }) =>
    services.guestPasses.extend(access, path.id, body.hours),
  );
