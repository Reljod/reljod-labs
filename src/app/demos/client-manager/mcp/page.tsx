import type { Metadata } from "next";
import { McpSetup } from "@/features/client-manager/components/mcp-setup";

export const metadata: Metadata = {
  title: "Use in Claude Code · Client Manager",
  description:
    "Connect Claude Code to the Client Manager MCP server: every client's knowledge graph, sources and confidence, and a research skill.",
};

export default function McpPage() {
  return <McpSetup />;
}
