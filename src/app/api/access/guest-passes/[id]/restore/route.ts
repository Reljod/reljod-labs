import { passParamsSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { params } from "@/platform/http/middleware";

/** A Host takes back a deleted pass before it is purged. */
export const POST = hostApi
  .use(params(passParamsSchema))
  .handle(({ services, access, path }) =>
    services.guestPasses.restore(access, path.id),
  );
