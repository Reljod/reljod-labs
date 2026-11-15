import type { Metadata } from "next";
import { Suspense } from "react";
import { currentAccess } from "@/features/access/server/gate";
import { McpSetup } from "@/features/client-manager/components/mcp-setup";

export const metadata: Metadata = {
  title: "Use in Claude Code · Client Manager",
  description:
    "Connect Claude Code to the Client Manager MCP server: every client's knowledge graph, sources and confidence, and a research skill.",
};

export default function McpPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-marble" />}>
      <Setup />
    </Suspense>
  );
}

/** A Guest's setup asks for their guest token beside the OAuth sign-in. */
async function Setup() {
  const access = await currentAccess();
  return <McpSetup guest={access?.kind === "guest"} />;
}
