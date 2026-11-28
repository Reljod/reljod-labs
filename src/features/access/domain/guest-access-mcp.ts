/**
 * The Guest access MCP server: a Host manages Guest passes from Claude or any
 * other MCP client, signed in with OAuth. Paths and tool names only, no Node
 * imports, so pages and client components can use them. The OAuth server
 * itself is `guest-access-oauth.ts`.
 */

export const GUEST_ACCESS_MCP_PATH = "/api/access/mcp";
export const GUEST_ACCESS_OAUTH_PATH = "/api/access/oauth";
/** The issuer: path-suffixed, so it is neither the Client Manager's (the bare origin) nor the Harness's. */
export const GUEST_ACCESS_ISSUER_PATH = "/api/access";
export const GUEST_ACCESS_AUTH_SERVER_METADATA_PATH = `/.well-known/oauth-authorization-server${GUEST_ACCESS_ISSUER_PATH}`;
/** RFC 9728: where the server's 401 points. */
export const GUEST_ACCESS_PROTECTED_RESOURCE_PATH = `/.well-known/oauth-protected-resource${GUEST_ACCESS_MCP_PATH}`;
/** The consent page (Host only). */
export const GUEST_ACCESS_AUTHORIZE_PATH = "/access/mcp/authorize";
/** How to connect a client (Host only). */
export const GUEST_ACCESS_CONNECT_PATH = "/access/mcp";
export const GUEST_ACCESS_OAUTH_SCOPE = "guest-access";
export const GUEST_ACCESS_SERVER_NAME = "reljod-labs-guest-access";
export const GUEST_ACCESS_RESOURCE_NAME = "Reljod Labs: Guest access";

/** A Host's sign-in lasts this long after they allow it; the client refreshes hourly within it. */
export const HOST_GRANT_DAYS = 30;

export type GuestAccessToolName =
  | "list_guest_passes"
  | "issue_guest_pass"
  | "extend_guest_pass"
  | "new_guest_code"
  | "revoke_guest_pass"
  | "delete_guest_pass"
  | "restore_guest_pass";

export type GuestAccessToolSpec = {
  name: GuestAccessToolName;
  title: string;
  /** One line, for the Connect page. */
  summary: string;
  readOnly: boolean;
  /** It ends a Guest's Access or hides their data: the client should ask first. */
  destructive: boolean;
};

/** Every tool, in the order the Connect page lists them. Each one calls the same server function as the Guest access page. */
export const GUEST_ACCESS_TOOLS: readonly GuestAccessToolSpec[] = [
  {
    name: "list_guest_passes",
    title: "List Guest passes",
    summary: "Every pass, live or ended, with its devices and when it ends.",
    readOnly: true,
    destructive: false,
  },
  {
    name: "issue_guest_pass",
    title: "Issue a Guest pass",
    summary: "A new pass for a named person, and its Guest code (shown once).",
    readOnly: false,
    destructive: false,
  },
  {
    name: "extend_guest_pass",
    title: "Extend or renew a Guest pass",
    summary: "Adds time to a live pass, or brings an ended one back.",
    readOnly: false,
    destructive: false,
  },
  {
    name: "new_guest_code",
    title: "Give a Guest pass a new code",
    summary: "Replaces a lost code and signs out the devices on the old one.",
    readOnly: false,
    destructive: true,
  },
  {
    name: "revoke_guest_pass",
    title: "Revoke a Guest pass",
    summary: "Ends a live pass now. It can be renewed later.",
    readOnly: false,
    destructive: true,
  },
  {
    name: "delete_guest_pass",
    title: "Delete a Guest pass",
    summary: "Deletes a pass; it and its data are purged after 30 days.",
    readOnly: false,
    destructive: true,
  },
  {
    name: "restore_guest_pass",
    title: "Restore a deleted Guest pass",
    summary: "Takes a deleted pass back, with everything its Guests saved.",
    readOnly: false,
    destructive: false,
  },
];
