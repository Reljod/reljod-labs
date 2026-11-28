import { mcpConsentSchema } from "@/features/access/domain/api";
import { hostApi } from "@/features/access/server/api";
import { body } from "@/platform/http/middleware";

/**
 * The Guest access consent page's Allow or Deny for an MCP client's sign-in.
 * Answers where the browser goes next: the client's callback, with a code or
 * an error. Only a Host gets that far, so it is no open redirect.
 */
export const POST = hostApi
  .use(body(mcpConsentSchema, { limit: 16 * 1024 }))
  .handle(({ services, access, body }) =>
    services.mcpConnect.answer(access, body),
  );
