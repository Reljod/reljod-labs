import { z } from "zod";
import type { ConsentResponse } from "@/features/harness/domain/api";
import { harnessApi } from "@/features/harness/server/api";
import { body } from "@/platform/http/middleware";

const schema = z.object({
  request: z.string().max(8_000),
  answer: z.enum(["allow", "deny"]),
  staffId: z.string().max(64).default(""),
  trustHost: z.string().max(300).nullish(),
});

/**
 * The consent page's Allow or Deny for an MCP client's OAuth sign-in
 * (`/demos/harness/mcp/authorize`): where to send the browser. Behind the
 * Access gate and same-origin, so nobody without Access is redirected
 * anywhere and no other site can post an answer; the authorization request
 * is read again here, never trusted from the page.
 */
export const POST = harnessApi.use(body(schema)).handle(
  ({ services, caller, body }): Promise<ConsentResponse> =>
    services.connect.consent(caller, {
      request: body.request,
      answer: body.answer,
      staffId: body.staffId,
      trustHost: body.trustHost ?? null,
    }),
);
