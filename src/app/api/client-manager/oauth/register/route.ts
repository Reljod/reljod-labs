import { openApi } from "@/features/client-manager/server/api";
import {
  oauthJson,
  preflight,
} from "@/features/client-manager/server/oauth-http";

/**
 * RFC 7591 dynamic registration. Nothing is stored: the client id is the
 * signed registration, so registering costs nothing and needs no Access.
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
  const { status, body } = services.connect.register(metadata);
  return oauthJson(body, status);
});

export const OPTIONS = preflight;
