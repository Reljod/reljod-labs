import { issueSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { body } from "@/platform/http/middleware";

/** A Host issues a Guest pass; the answer carries its Guest code, shown once. */
export const POST = hostApi
  .use(body(issueSchema, { limit: 8 * 1024 }))
  .handle(({ services, access, body }) =>
    services.guestPasses.issue(access, body),
  );
