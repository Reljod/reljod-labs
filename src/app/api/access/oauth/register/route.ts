import { openApi } from "@/features/access/server/api";
import { oauthJson, preflight } from "@/features/access/server/oauth-http";

/**
 * RFC 7591 dynamic registration for the Guest access server. Nothing is
 * stored: the client id is the signed registration, so registering needs no
 * Access. Only a Host can then allow it, on the consent page.
 */
export const POST = openApi.handle(async ({ services, request }) => {
  let metadata: unknown;
  try {
    metadata = await request.json();
  } catch {
    return oauthJson(
      {
        error: "invalid_client_metadata",
        error_description: "Send the registration as JSON.",
      },
      400,
    );
  }
  const { status, body } = services.mcpConnect.register(metadata);
  return oauthJson(body, status);
});

export const OPTIONS = preflight;
