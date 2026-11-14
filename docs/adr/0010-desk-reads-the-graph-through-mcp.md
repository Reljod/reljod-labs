# The Desk reads the graph only through the Client Manager MCP server

The Client Manager chat moved out of the Client page into its own tab, the Desk, and now answers about the whole book or one Client. Its model reaches the graphs through the Client Manager MCP server (`/api/client-manager/mcp`), called in process with a short-lived Desk token narrowed to the Thread's Client, exactly as Claude Code would call it with an MCP token from the MCP page. The graph tools (profile, search across Clients, expand, connect, browse, read facts with quotes, documents, research brief, add facts) live in `server/graph-tools.ts` and are registered once in `server/mcp.ts`.

We chose one server for both over chat-only tools so that what the app can answer and what an outside agent can answer never drift apart, and so that scoping (a Thread about one Client) is enforced by the token, not by the prompt. Web search stays out of the server: it is the Desk's own tool (AI Gateway's Perplexity search), and outside clients bring their own.

Research never writes on its own. The Desk ends a research turn with `propose_facts`, a local tool that only shows a card; the person ticks findings and the app adds them as one `web` Source through the same addition Build as an Intake. On the MCP server, `add_facts` exists for agents that have asked their user first (the research skill and the `research_client` prompt say so).

## Consequences

- Tokens are signed, not stored (`domain/mcp-token.ts`, keyed from `RATE_LIMIT_SALT`). A Guest token is checked against the Guest pass on every call and dies with it; a Host token lasts 30 days and stops when the email leaves `ACCESS_HOST_EMAILS`. Rotating the salt revokes every token.
- Citations carry the Client: `[[handle/key]]`. Old per-client messages keep their bare Keys; nothing renders them now.
- Research turns are capped per hour (`LIMITS.researchPerHour`) on top of the ask limit; adding findings passes the build limits like any addition.
- The Client file loads in parts (`/clients/:id` without Edges or quotes, `/edges?scope=`, `/node?key=`, `/sources/:id`), so opening a Client no longer reads the whole graph.
