import { passParamsSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { params } from "@/platform/http/middleware";

/** A Host gives a pass a new Guest code; the devices on the old one are signed out. */
export const POST = hostApi
  .use(params(passParamsSchema))
  .handle(({ services, access, path }) =>
    services.guestPasses.newCode(access, path.id),
  );
