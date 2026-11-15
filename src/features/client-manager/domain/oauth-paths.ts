/**
 * Where the Client Manager's OAuth pieces live. No Node imports, so client
 * components (the MCP page) can read them without pulling in `node:crypto`.
 */
export const MCP_PATH = "/api/client-manager/mcp";
export const OAUTH_PATH = "/api/client-manager/oauth";
export const AUTHORIZE_PATH = "/demos/client-manager/mcp/authorize";
export const PROTECTED_RESOURCE_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
export const OAUTH_SCOPE = "client-manager";
/** Where a Guest's OAuth requests carry their guest token. */
export const GUEST_TOKEN_HEADER = "X-Guest-Token";
