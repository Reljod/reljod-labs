import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "claude-oauth",
  section: "claude",
  title: "OAuth sign-in step by step",
  summary:
    "What happens when Claude signs in: discovery, registration, consent with PKCE, and a token.",
  body: [
    md`
The MCP server follows the MCP authorization flow: OAuth 2.1 with PKCE. You do not copy a secret. The Harness has its own OAuth endpoints, so its sign-ins never cross with the Client Manager's.

## The steps

1. **Claude calls the MCP server** at §/api/harness/mcp§ with no token. The server answers 401 and names its protected-resource metadata.
2. **Claude reads the metadata** at §/.well-known/oauth-protected-resource/api/harness/mcp§ (RFC 9728). It names the authorization server.
3. **Claude reads the authorization server's metadata** at §/.well-known/oauth-authorization-server/api/harness§ (RFC 8414). The issuer is §<origin>/api/harness§, so the Harness's sign-ins never meet the Client Manager's, whose issuer is the site's origin. The metadata lists the endpoints.
4. **Claude registers itself** with a POST to §/api/harness/oauth/register§ (RFC 7591), naming its redirect addresses.
5. **Claude sends you to the consent page** at §/demos/harness/mcp/authorize§ with a PKCE challenge. The page is behind the Access gate, so a visitor without Access signs in first and comes back.
6. **You choose a Staff member and allow it.** That Staff member is who Claude acts as.
7. **The page sends you back to Claude** with a short-lived code.
8. **Claude trades the code and the PKCE verifier for a token** with a POST to §/api/harness/oauth/token§.
9. **Claude calls the MCP server** with the token. The server checks the Role of the Staff member on every call.
`,
    { diagram: "oauth" },
    md`
## What the consent page shows

- who is asking (the client's name and where it sends you back to);
- the Staff member Claude will act as, and that Staff member's Role;
- what that allows, in the words of the [permission matrix](#doc:workspace-staff-roles).

An unknown client or redirect address is shown on the page and never redirected to. The page cannot be shown in a frame.

## A Guest's sign-in

A Guest signs in the same way, and then also sends a guest token (a pasted Harness token) in the §X-Guest-Token§ header with each call. See [Connect Claude](#doc:claude-connect#a-guest-s-sign-in). The server refuses a call from a Guest's OAuth token without it, with a 403. Claude.ai's custom connectors cannot send the header, so a Guest uses Claude Code or a §.mcp.json§.

## Lifetimes and revoking

- The code is short-lived and useless without the PKCE verifier only Claude holds.
- The access token is short-lived. Claude refreshes it, and each refresh checks that you still have Access.
- A Guest's sign-in ends with their Guest pass. A revoked pass or a Host removed from the list stops working.

## What a token cannot do

A token acts as one Staff member and nothing else. It cannot give an Approval, because no tool does. Changing Staff in the app does not change a token already issued. To act as someone else, sign in again and choose them.

## Security notes

- The flow is stateless: the client id (§hxc_…§), the code (§hxo_…§) and the refresh token (§hxr_…§) are signed values, not rows in a table. The access token is a Harness token (§hxm_…§), the same kind the chat and the Connect page's pasted token use. An access token lasts an hour. Rotating the server's signing salt revokes every client at once.
- Redirect addresses must be https, or http on a loopback address.
- Details and consequences are in [Decisions](#doc:ref-decisions), ADR 0012 and ADR 0013.
`,
  ],
};
