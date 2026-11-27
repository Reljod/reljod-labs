import { redeemCodeOnce } from "@/features/access/server/mcp-tokens";
import { redeem, tokensFor } from "@/features/client-manager/domain/oauth";
import { env } from "@/features/client-manager/server/env";
import { verifyBearer } from "@/features/client-manager/server/mcp-auth";
import {
  oauthJson,
  preflight,
} from "@/features/client-manager/server/oauth-http";

/**
 * The token endpoint: a code (with its PKCE verifier) or a refresh token for
 * an hour's MCP token. Each time it checks the holder still has Access and
 * the Grant was given after the Owner last disconnected their MCP clients, so
 * a revoked Guest pass, a Host taken off the list or a disconnected client
 * gets nothing more. A code is redeemed once.
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
  // A code is good once: a second redemption, even within its two minutes
  // and with the right verifier, gets nothing.
  if (
    result.code &&
    !(await redeemCodeOnce(result.code.value, result.code.exp))
  )
    return oauthJson(
      {
        error: "invalid_grant",
        error_description: "This code was already used. Sign in again.",
      },
      400,
    );
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
