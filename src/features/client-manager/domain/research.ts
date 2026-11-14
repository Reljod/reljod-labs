/**
 * The client research skill: one set of steps, served as the MCP server's
 * `research_client` prompt and as a Claude Code skill file on the MCP page.
 */

export const MCP_SERVER_NAME = "client-manager";

export function researchSteps(client: string) {
  return `1. Call research_brief for ${client} to see what is known and which Categories are empty.
2. Search the web for public, professional facts that fill those gaps: roles and companies, board seats, exits and funding rounds, public filings, philanthropy, press interviews, awards. Prefer primary and reputable sources. Make sure each finding is about this person, not a namesake: match employer, city or age with what the graph already knows.
3. Drop anything already in the graph, anything private (health, home address, family disputes) and anything you could not tie to a URL.
4. Show the person the findings as a short numbered list: one plain sentence each, how sure you are (high, medium, low) and the source. Ask which to add. Do not add anything they did not choose.
5. Call add_facts with only the chosen facts, each with its sourceUrl and sourceTitle. Then tell them the build is running.`;
}

export function researchPrompt(client: string) {
  return `Research ${client} for their wealth manager, and add what is worth keeping to their knowledge graph.

${researchSteps(`"${client}"`)}`;
}

/** A Claude Code skill (SKILL.md) that runs the research with Claude Code's own web search. */
export function researchSkill() {
  return `---
name: client-research
description: Research a wealth-management client on the web and add the findings the user approves to their Client Manager knowledge graph. Use when asked to research, look up, dig into or update what we know about a client.
---

# Client research

Uses the \`${MCP_SERVER_NAME}\` MCP server for everything about the client, and your own web search for the research.

If the user did not name a client, call \`list_clients\` and ask which one.

${researchSteps("the client")}

Rules:
- Samples are read-only: research them if asked, but do not call add_facts for them.
- One fact per sentence. Keep numbers, dates and names exactly as the source states them.
- Never add a fact without a sourceUrl from your search.
`;
}

/** What the MCP server offers, as the setup page lists it. */
export const MCP_TOOLS: { name: string; does: string; writes?: boolean }[] = [
  { name: "list_clients", does: "Your book" },
  { name: "client_profile", does: "Persona and direct relations" },
  { name: "search", does: "Facts across every client" },
  { name: "expand", does: "Walk outward (pgRouting)" },
  { name: "connect", does: "How two facts relate" },
  { name: "browse_category", does: "A whole area" },
  { name: "read_facts", does: "Quotes and confidence" },
  { name: "list_documents", does: "The sources" },
  { name: "read_document", does: "A source, with what it backs" },
  { name: "research_brief", does: "What is known, what is missing" },
  { name: "add_facts", does: "Add approved facts", writes: true },
  { name: "build_status", does: "Is it in yet" },
];
