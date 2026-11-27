import { refractRequestSchema } from "@/features/prism/domain/api";
import { prismApi } from "@/features/prism/server/api";
import { body } from "@/platform/http/middleware";

/** One Refraction of a Slip: the cap is taken before the Decision Model call. */
export const POST = prismApi
  .use(body(refractRequestSchema))
  .handle(({ services, owner, visitor, body, request }) =>
    services.refract({ owner, visitor }, body, request.signal),
  );
