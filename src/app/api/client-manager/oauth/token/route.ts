import { openApi } from "@/features/client-manager/server/api";
import {
  oauthJson,
  preflight,
} from "@/features/client-manager/server/oauth-http";

/**
 * The token endpoint: a code (with its PKCE verifier) or a refresh token for
 * an hour's MCP token, minted only while the holder still has Access and the
 * Grant is newer than the Owner's last "Disconnect all MCP clients". A code
 * is redeemed once.
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
  const { status, body } = await services.connect.exchange(form);
  return oauthJson(body, status);
});

export const OPTIONS = preflight;
