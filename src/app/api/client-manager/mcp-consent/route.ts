import { consentSchema } from "@/features/client-manager/domain/consent";
import { consentApi } from "@/features/client-manager/server/consent-api";
import { body } from "@/platform/http/middleware";

/**
 * The consent page's Allow or Deny for an MCP client's sign-in. Answers
 * where the browser goes next: the client's callback, with a code or an
 * error. The authorization request is read again here.
 */
export const POST = consentApi
  .use(body(consentSchema, { limit: 16 * 1024 }))
  .handle(({ services, access, body }) => services.answer(access, body));
