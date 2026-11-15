# MCP clients sign in to the Client Manager with OAuth, statelessly

Outside MCP clients reached the Client Manager MCP server with a token copied from the MCP page and pasted into a `--header`. That meant a 300-character secret in a shell command and in `.mcp.json` (often committed), a page that had to mask it, and no way to connect clients that only speak OAuth, such as Claude.ai custom connectors.

The server now follows the MCP authorization spec. Its 401 names its Protected Resource Metadata (`/.well-known/oauth-protected-resource/api/client-manager/mcp`, RFC 9728), which names the site as the authorization server (`/.well-known/oauth-authorization-server`, RFC 8414). A client registers itself (`/api/client-manager/oauth/register`, RFC 7591), sends the person to the consent page (`/demos/client-manager/mcp/authorize`) with a PKCE S256 challenge, and trades the code for tokens at `/api/client-manager/oauth/token`. The consent page sits behind the Access gate, so a visitor without Access goes through the door (or the Host sign-in, which now honours `next`) and comes back.

We kept it stateless, like the MCP token (ADR 0010): the client id is the signed registration (its redirect URIs), the code is a signed Grant with the PKCE challenge and a two-minute life, and the refresh token is the signed Grant until it ends. The access token is an ordinary MCP token that lives an hour, so `verifyBearer` and the Guest pass check are unchanged. A **Grant** is what the person allowed: the MCP claims of whoever was signed in at consent, and when it ends (a Host's 30 days later, a Guest's with their pass). We chose this over tables for clients, codes and tokens because nothing else in the Client Manager needs them and a migration to the live project waits on the user.

## Consequences

- A code can be replayed within its two minutes, which the spec forbids; it is useless without the PKCE verifier only the client holds. Refresh tokens are not rotated out: an old one works until the Grant ends. Rotating `RATE_LIMIT_SALT` revokes every client, code and token at once.
- Every refresh checks the holder still has Access before minting, so a revoked Guest pass or a Host off the list stops at the next hour at most (and at once on the MCP server, which checks on every call).
- Redirect URIs are https, or http on loopback with any port (RFC 8252). An unknown client or redirect URI is shown on the page and never redirected to. The consent page refuses to be framed.
- The pasted token stays, behind a fold on the MCP page, for clients without OAuth. It is shown whole, so the person sees exactly what they copy.
