# 0031. Canvas: a View is a typed grammar, drawn by one MCP App, behind a Guard

Date: 2026-11-19. Status: accepted.

## Context

Canvas answers a question about data with an interface instead of a paragraph. Three things had to be decided together: what the model emits, who draws it, and what stands between the model and the data.

## Decisions

**1. The Analyst emits a View in a typed, versioned grammar (`canvas.view/1`), never HTML.** A spec names a Query, an encoding (line, area, bar, scatter, heatmap, pie, table, map, stat), Parameters, Controls bound to them, Annotations, a Finding and its Claims (`domain/view.ts`, zod). Trusted code draws it. Reasons: a spec can be checked by code before it is shown (fields exist, pie slices, bars from zero, a colour-blind-safe palette), every View looks like the product in light and dark, there is no model-written script to sandbox against the person's session, and a spec can be re-run with new Parameter values with no model call. The cost is that the model cannot invent a new kind of chart; there is no free-form custom View in this version, and a new kind is a code change to the grammar and the App.

**2. One implementation of the interface: an MCP App.** `create_view`, `show_view` and `update_view_params` are MCP Apps tools (`_meta.ui.resourceUri`, plus the older flat key) pointing at the UI resource `ui://canvas/view.html` (`text/html;profile=mcp-app`). They return the `ViewPayload` as `structuredContent`; the model reads only a short text. The App (`src/features/canvas/app/`, Preact, bundled by `pnpm build:canvas-app` into one self-contained HTML string) speaks the MCP Apps bridge on the stable `2026-01-26` wire format with a hand-rolled client of about 300 lines: the official `ext-apps` package would have added a peer SDK the repo does not carry and 130 KB gzipped, and the bridge is small. Claude renders this resource; so does our page.

**3. Our page is an MCP Apps host, on one origin.** The page fetches the App with `resources/read` through a real MCP client (`@ai-sdk/mcp`, in process, a ten-minute token for the person) and puts the document in `<iframe sandbox="allow-scripts">`: an opaque origin with no cookies, storage or same-origin access to the page. The App's `tools/call` is proxied by a gated route to the MCP server, limited to the tools whose visibility includes the App. The specification asks a web host to serve the App from a second origin behind a sandbox proxy frame. This site has one origin, so we deviate: instead of a second origin we rely on the sandbox's opaque origin (never `allow-same-origin`), and the Content-Security-Policy is built from the resource's own `_meta.ui.csp` (sanitised; the App declares nothing, so it is `default-src 'none'` with inline script and style only) and delivered both as a response header and as a meta tag inside the `srcdoc` document. The document goes in `srcdoc` because a sandboxed frame sends no cookies of its own to fetch a gated URL.

**4. The Guard reads the parsed statement, in code, at the query tool.** Every Query from the page, the Analyst or an outside client goes through `server/runs.ts`: DuckDB parses it (`json_serialize_sql`), `domain/guard.ts` (pure, unit-tested on statements DuckDB really produced) walks the tree, and only then does it run. It refuses anything but one SELECT, any Table outside the Catalog, every table function that could read a file, and a Restricted column anywhere but inside a summarising aggregate. Where a Restricted column is aggregated it adds `HAVING count(*) >= <minimum group size>` to that SELECT in the tree, and the rewritten tree is what runs (`json_deserialize_sql`). The connection is read-only with external access switched off and configuration locked, as a second layer. Text matching was rejected: a comment, a quoted name or a subquery hides things from a regular expression, not from the parser.

**5. Code, not the model, says Verified.** A Claim says where its number is in the View's rows (column, aggregate, optional where). `domain/verify.ts` recomputes it and compares within the Rules' tolerance, and reads the Finding for figures no Claim backs. The View is stamped Verified or Flagged by that code alone; the Analyst may revise a Flagged View in place.

**6. The chat streams from one function; the tools are the MCP server.** A Question is answered by `streamText` in the chat route, with the MCP server's tools called in process (ADR 0013's shape), so a View appears as soon as its tool returns. The harness owns the caps: turns, USD per Question, Sandbox seconds, rows.

## Consequences

- A Control change is one tool call and one Query: no model, no parse (the Guard's verdict is stored with the View and reused while the Rulebook version is unchanged).
- Anything the page can do, an outside client can do with the same Rules, limits and Trail, because both go through the same server functions.
- The generated App bundle is committed; change the App, run `pnpm build:canvas-app`.
- If the site ever gains a second origin for untrusted content, the host should move to the specification's double frame.
