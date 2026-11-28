# Hosts manage Guest passes over MCP, through a shared stateless OAuth server

Hosts issued, extended and revoked Guest passes only on `/access/guests`. A Host who works in Claude, Claude Code or another harness had to switch to the browser for each pass. We added the Guest access MCP server at `/api/access/mcp`. It does what the page does, and only a Host can connect a client to it.

It signs in the way ADR 0012 set out: Protected Resource Metadata (RFC 9728), its own issuer `/api/access` (RFC 8414 §3.1, path-suffixed so it is neither the Client Manager's bare-origin issuer nor the Harness's), dynamic registration (RFC 7591), PKCE S256, and signed blobs instead of tables. The consent page sits at `/access/mcp/authorize`, beside the Host's other pages, and the proxy sends anyone who is not a Host to the Host sign-in, which comes back to it.

We did not copy the Client Manager's or the Harness's OAuth module a third time. `src/features/access/domain/mcp-oauth.ts` exports `statelessOAuth(config, readClaims)`, which builds the whole authorization server for one MCP server from its paths, scope, blob prefix and HMAC context. The Guest access server is its first user. The two older servers keep their own copies for now. Moving them over would change their blob formats and sign every connected client out, so that waits for a change of its own.

The tools call the same `GuestPassService` as the REST routes (`server/services/guest-passes.ts`). The live-pass cap, the duration list and the renew rules therefore stay in one place. No tool checks who is asking: the MCP handler does that on every request, before any tool runs.

## Consequences

- A token stops as soon as the account stops being a Host. Each request asks the Supabase Auth admin API for the account, about one round trip per call, and checks the email still matches the one at consent. A Host's "Disconnect all MCP clients" covers this server through the shared token epoch, and a code is redeemed once (`access.redeemed_oauth_codes`).
- A connected client can issue passes and read their Guest codes, which come back in its chat. The consent page says so, and the destructive tools carry `destructiveHint` so clients ask before running them.
- Guests and the e2e suite cannot connect. There is no pasted token, so a client that cannot do OAuth cannot connect either.
- Rotating `RATE_LIMIT_SALT` revokes every client of all three servers at once.
