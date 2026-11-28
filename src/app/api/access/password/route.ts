import { passwordSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { body } from "@/platform/http/middleware";

/** A Host changes their password, proving the current one first (counted like a sign-in). */
export const PUT = hostApi
  .use(body(passwordSchema, { limit: 8 * 1024 }))
  .handle(({ services, access, browser, visitor, body }) =>
    services.profile.changePassword(access, browser, visitor, body),
  );
