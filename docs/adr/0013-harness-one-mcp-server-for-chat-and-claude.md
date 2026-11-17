# The Harness has one way in: its MCP server, for the built-in chat and for Claude alike

The Harness must be "fully Claude compatible" and also usable by someone without Claude. Two tool surfaces (chat-only tools and MCP tools) would drift, and the claim would stop being true the first time a feature landed on one side only.

Everything the Agent can do is a tool on the Harness MCP server (`/api/harness/mcp`): each Pipeline, Run status, Knowledge base search and ingest, record lookups, the Audit trail, Skills and the Sandbox. The built-in chat calls that server in process with a short-lived token, the way Casework and the Client Manager do (ADR 0007 jobs-as-MCP-tools, ADR 0010). Outside clients sign in with OAuth as in ADR 0012. The only chat-local tools are web search (a Connector of its own) and `load_skill`, which reads a Skill the server also serves.

Skills are `SKILL.md` documents (name, description, body). The chat lists names and descriptions in its instructions and loads a body on demand, as Claude does. `/api/harness/plugin` builds a Claude plugin zip from the Workspace's current Skill Versions and the server's address, so Claude gets the Skills the visitor edited, not a stale copy.

An MCP token names an Owner and a Staff member. The server checks the Role on every call. No tool gives an Approval: a person does that in the app, so neither the Agent nor an outside Claude can approve its own work.

## Consequences

- A new capability is a new MCP tool, never a chat-only tool.
- The Staff member is fixed when the token is minted (the Session's Staff member, or the one chosen on the consent page). Changing Staff in the app does not change a token already issued to Claude.
- The OAuth endpoints are the Harness's own (`/api/harness/oauth/*`, metadata at the path-suffixed well-known URLs) so the Client Manager's grants and the Harness's never cross.
