import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "connect-claude-quick",
  section: "get-started",
  title: "Connect Claude in five minutes",
  summary:
    "Add the Harness as a connector in Claude, sign in once, and ask Claude to run a Pipeline.",
  body: [
    md`
You need Access to the demos (a Host account or a Guest code) and a Claude client. The full steps, with what happens at each one, are in [Connect Claude](#doc:claude-connect).

## 1. Get the address

Open the Connect page at §/demos/harness/mcp§ ([open the Connect page](/demos/harness/mcp)). It shows the connector URL:

§§§text
<your-site>/api/harness/mcp
§§§

## 2. Add it

**Claude.ai or Cowork.** Open Settings, then Connectors, then add a custom connector. Paste the URL above.

**Claude Code.** Run:

§§§bash
claude mcp add --transport http harness <your-site>/api/harness/mcp
§§§

## 3. Sign in

Claude opens the Harness's consent page. Check who you are signing in as, and allow it. If you are a Guest, you also need to paste your guest token. See [OAuth sign-in step by step](#doc:claude-oauth).

## 4. Try it

Ask Claude:

> List the Harness Pipelines, then run the member request Pipeline for a transfer out.

Claude starts a Run and gives you a link. The Run stops at an Approval, and a person gives that in the app. Claude cannot. See [What Claude cannot do](#doc:claude-limits).

## Also install the Skills

The Plugin gives Claude the same Skills as the built-in chat. See [Install the Claude Plugin](#doc:claude-plugin).
`,
  ],
};
