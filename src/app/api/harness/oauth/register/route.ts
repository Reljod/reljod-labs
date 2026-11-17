import { registerClient } from "@/features/harness/domain/oauth";
import { env } from "@/features/harness/server/env";
import { oauthJson, preflight } from "@/features/harness/server/oauth-http";

/**
 * RFC 7591 dynamic registration for the Harness. Nothing is stored: the
 * client id is the signed registration, so registering needs no Access.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthJson(
      {
        error: "invalid_client_metadata",
        error_description: "Send the registration as JSON.",
      },
      400,
    );
  }
  const result = registerClient(body, env.rateLimitSalt(), Date.now());
  if (!result.ok) {
    const { ok: _ok, ...error } = result;
    return oauthJson(error, 400);
  }
  return oauthJson(result.registration, 201);
}

export const OPTIONS = preflight;
