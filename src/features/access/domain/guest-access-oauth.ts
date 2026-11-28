import {
  GUEST_ACCESS_AUTHORIZE_PATH,
  GUEST_ACCESS_ISSUER_PATH,
  GUEST_ACCESS_MCP_PATH,
  GUEST_ACCESS_OAUTH_PATH,
  GUEST_ACCESS_OAUTH_SCOPE,
  GUEST_ACCESS_RESOURCE_NAME,
  HOST_GRANT_DAYS,
} from "./guest-access-mcp";
import { type Grant, statelessOAuth } from "./mcp-oauth";

/**
 * Who a Guest access token acts for: always a Host, never a Guest or the e2e
 * suite. The server asks Supabase Auth on every call whether the account is
 * still a Host, and checks the email still matches.
 */
export type HostClaims = { userId: string; email: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readHostClaims(value: unknown): HostClaims | null {
  if (!value || typeof value !== "object") return null;
  const { userId, email } = value as Record<string, unknown>;
  if (typeof userId !== "string" || !UUID.test(userId)) return null;
  if (typeof email !== "string" || !email.includes("@")) return null;
  return { userId, email };
}

/** Signs under `guest-access`, prefix `ga`: no Client Manager or Harness blob verifies here. */
export const guestAccessOAuth = statelessOAuth<HostClaims>(
  {
    prefix: "ga",
    context: "guest-access",
    scope: GUEST_ACCESS_OAUTH_SCOPE,
    issuerPath: GUEST_ACCESS_ISSUER_PATH,
    mcpPath: GUEST_ACCESS_MCP_PATH,
    oauthPath: GUEST_ACCESS_OAUTH_PATH,
    authorizePath: GUEST_ACCESS_AUTHORIZE_PATH,
    resourceName: GUEST_ACCESS_RESOURCE_NAME,
  },
  readHostClaims,
);

/** What a Host allows on the consent page: their own account, for HOST_GRANT_DAYS. */
export function hostGrant(
  host: { userId: string; email: string },
  now = Date.now(),
): Grant<HostClaims> {
  const seconds = Math.floor(now / 1000);
  return {
    claims: { userId: host.userId, email: host.email },
    iat: seconds,
    until: seconds + HOST_GRANT_DAYS * 86_400,
  };
}
