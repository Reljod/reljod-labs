import { redeem, tokensFor } from "@/features/client-manager/domain/oauth";
import { env } from "@/features/client-manager/server/env";
import { verifyBearer } from "@/features/client-manager/server/mcp-auth";
import {
  oauthJson,
  preflight,
} from "@/features/client-manager/server/oauth-http";

/**
 * The token endpoint: a code (with its PKCE verifier) or a refresh token for
 * an hour's MCP token. Each time it checks the holder still has Access, so a
 * revoked Guest pass or a Host taken off the list gets nothing more.
 */
export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthJson(
      { error: "invalid_request", error_description: "Unreadable body." },
      400,
    );
  }
  const secret = env.rateLimitSalt();
  const now = Date.now();
  const result = redeem(form, secret, now);
  if (!result.ok) {
    const { ok: _ok, ...error } = result;
    return oauthJson(error, error.error === "invalid_client" ? 401 : 400);
  }
  const tokens = tokensFor(result.grant, result.clientId, secret, now);
  if (!(await verifyBearer(tokens.access_token))) {
    return oauthJson(
      {
        error: "invalid_grant",
        error_description: "This access has ended. Sign in again.",
      },
      400,
    );
  }
  return oauthJson(tokens);
}

export const OPTIONS = preflight;
