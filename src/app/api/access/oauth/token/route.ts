import { openApi } from "@/features/access/server/api";
import { oauthJson, preflight } from "@/features/access/server/oauth-http";

/**
 * The Guest access token endpoint: a code (with its PKCE verifier) or a
 * refresh token for an hour's access token, minted only while the account is
 * still a Host and the sign-in is newer than the Host's last "Disconnect all
 * MCP clients". A code is redeemed once.
 */
export const POST = openApi.handle(async ({ services, request }) => {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthJson(
      { error: "invalid_request", error_description: "Unreadable body." },
      400,
    );
  }
  const { status, body } = await services.mcpConnect.exchange(form);
  return oauthJson(body, status);
});

export const OPTIONS = preflight;
