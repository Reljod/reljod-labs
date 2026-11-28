import { guestAccessOAuth } from "@/features/access/domain/guest-access-oauth";
import {
  oauthJson,
  originOf,
  preflight,
} from "@/features/access/server/oauth-http";

/**
 * RFC 8414 §3.1 for the Guest access issuer, `<origin>/api/access`. The bare
 * `/.well-known/oauth-authorization-server` stays the Client Manager's, so
 * the grants never cross.
 */
export function GET(request: Request) {
  return oauthJson(
    guestAccessOAuth.authorizationServerMetadata(originOf(request)),
  );
}

export const OPTIONS = preflight;
