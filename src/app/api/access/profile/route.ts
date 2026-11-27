import { profileSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { body } from "@/platform/http/middleware";

/** A Host changes the name shown on their profile. */
export const PATCH = hostApi
  .use(body(profileSchema, { limit: 8 * 1024 }))
  .handle(({ services, access, browser, body }) =>
    services.profile.rename(access, browser, body.name),
  );
