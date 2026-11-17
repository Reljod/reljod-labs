import { authorizationServerMetadata } from "@/features/harness/domain/oauth";
import {
  oauthJson,
  originOf,
  preflight,
} from "@/features/harness/server/oauth-http";

/**
 * RFC 8414 §3.1 for the Harness's issuer, `<origin>/api/harness`. The bare
 * `/.well-known/oauth-authorization-server` stays the Client Manager's, so
 * the two grants never cross.
 */
export function GET(request: Request) {
  return oauthJson(authorizationServerMetadata(originOf(request)));
}

export const OPTIONS = preflight;
