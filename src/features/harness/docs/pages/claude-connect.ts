import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "claude-connect",
  section: "claude",
  title: "Connect Claude",
  summary:
    "Add the Harness to Claude.ai, Claude Desktop or Claude Code with the connector URL. A Guest uses Claude Code.",
  body: [
    md`
Before you start, you need Access to the demos: a Host account, or a Guest code and a guest token. The Connect page at [/demos/harness/mcp](/demos/harness/mcp) shows everything below with your own address filled in.

The connector URL is:

§§§text
<your-site>/api/harness/mcp
§§§

## Claude.ai or Claude Desktop

1. Open Settings, then Connectors.
2. Choose Add custom connector.
3. Paste the connector URL and save.
4. Choose Connect. Claude opens the Harness's consent page, where you choose the Staff member Claude acts as and Allow. See [OAuth sign-in step by step](#doc:claude-oauth).

This is for a Host. A Guest's sign-in must also carry a header (see [A Guest's sign-in](#a-guest-s-sign-in)), and a custom connector in Claude.ai cannot send one, so a Guest uses Claude Code or a §.mcp.json§.

## Claude Code

Add it with one command:

§§§bash
claude mcp add --transport http harness <your-site>/api/harness/mcp
§§§

Then run §/mcp§ inside Claude Code, choose §harness§ and sign in through the browser.

To share the setup with a project, put it in a §.mcp.json§ at the project root:

§§§json
{
  "mcpServers": {
    "harness": {
      "type": "http",
      "url": "<your-site>/api/harness/mcp"
    }
  }
}
§§§

No secret goes in this file when you sign in with OAuth, so it is safe to commit. A Guest needs one more line, and that line holds a secret, so a Guest should not commit the file. See [A Guest's sign-in](#a-guest-s-sign-in).

## A pasted token, when OAuth is not available

Some clients cannot do OAuth. On the Connect page, a Host opens **No OAuth? Paste a token instead** and presses **Create a token**. The token is made for the Staff member you are signed in as, starts with §hxm_§ and is shown whole, with when it ends. Paste it as a header:

§§§bash
claude mcp add --transport http harness <your-site>/api/harness/mcp \
  --header "Authorization: Bearer <your-token>"
§§§

A token is a secret. It acts as your Staff member and works until it expires. Do not commit it.

## A Guest's sign-in

A Guest's OAuth access token must be paired with a guest token, sent in the §X-Guest-Token§ header. The guest token is a pasted Harness token (§hxm_…§): on the Connect page, a Guest presses **Create a token** under Claude Code. The server checks that the guest token belongs to the same Guest pass, on every call. Without it, the call is refused with a 403 that says so. Claude.ai and Claude Desktop custom connectors cannot send a custom header, so a Guest cannot use them.

§§§bash
claude mcp add --transport http harness <your-site>/api/harness/mcp \
  --header "X-Guest-Token: <your-guest-token>"
§§§

In §.mcp.json§:

§§§json
{
  "mcpServers": {
    "harness": {
      "type": "http",
      "url": "<your-site>/api/harness/mcp",
      "headers": { "X-Guest-Token": "<your-guest-token>" }
    }
  }
}
§§§

The Connect page puts your guest token into these snippets once you have created it. A guest token ends with the Guest pass. A Host needs no header.

## Check it works

Ask Claude: "List the Harness Pipelines." It should call §list_pipelines§. Then see [Example prompts to try in Claude](#doc:claude-prompts).

## If it does not connect

- **A 401** means Claude is not signed in. Sign in again.
- **A 403 for a Guest** means the guest token header is missing or belongs to another pass.
- **A 403 on one tool** means the Staff member's Role does not allow it. See [MCP tool reference](#doc:claude-tools).
- **A 429** means a limit. See [Limits](#doc:ref-limits).
`,
  ],
};
