import { redeem, tokensFor } from "@/features/harness/domain/oauth";
import { env } from "@/features/harness/server/env";
import { actorOf, verifyBearer } from "@/features/harness/server/mcp-auth";
import { oauthJson, preflight } from "@/features/harness/server/oauth-http";

/**
 * The Harness's token endpoint: a code (with its PKCE verifier) or a refresh
 * token for an hour's Harness token. Each time it checks the holder still has
 * Access and the Staff member is still in the Workspace before minting.
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
  const claims = await verifyBearer(tokens.access_token);
  if (!claims || !(await actorOf(claims))) {
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
