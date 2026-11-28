import { guestAccessOAuth } from "@/features/access/domain/guest-access-oauth";
import {
  oauthJson,
  originOf,
  preflight,
} from "@/features/access/server/oauth-http";

/** RFC 9728: the Guest access MCP server's 401 points here, and this names its own issuer. */
export function GET(request: Request) {
  return oauthJson(
    guestAccessOAuth.protectedResourceMetadata(originOf(request)),
  );
}

export const OPTIONS = preflight;
