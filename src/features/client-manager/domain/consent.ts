import { z } from "zod";

/** The consent page's Allow and Deny post here; the answer names where the browser goes. */
export const MCP_CONSENT_ROUTE = "/api/client-manager/mcp-consent";

export const consentSchema = z.object({
  /** The authorization request's query, checked again on the server. */
  request: z.string().max(8192),
  answer: z.enum(["allow", "deny"]),
  /** The callback host the person ticked "I trust", if they did. */
  trustHost: z.string().max(512).nullish(),
});

export type ConsentAnswer = z.infer<typeof consentSchema>;
