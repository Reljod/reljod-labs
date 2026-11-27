import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { requireOwner } from "@/features/access/server/gate";
import { Canvas } from "@/features/canvas/components/canvas";
import { CanvasSkeleton } from "@/features/canvas/components/skeleton";
import type {
  CatalogTableInfo,
  RulesResponse,
} from "@/features/canvas/domain/api";
import { MERIDIA_CATALOG } from "@/features/canvas/domain/catalog";
import type { ConversationSummary } from "@/features/canvas/domain/chat";
import { canvas } from "@/features/canvas/server/container";
import { currentRequest } from "@/platform/request/current";

export const metadata: Metadata = {
  title: "Canvas · Demo",
  description:
    "An analyst that answers a question about a million rows with a working interface: charts with controls delivered as MCP Apps, queries run in a sandbox, and every narrated number recomputed by code.",
};

/*
 * The Catalog is seed data, built into the static shell. The Owner's
 * Conversations and Rulebook come from the request's cookies, so they are
 * read behind Suspense (`cacheComponents` is on), through the same services
 * as the REST routes, and handed down. The Access gate runs in
 * `src/proxy.ts`, here, and again in every route.
 */
export default function CanvasDemoPage() {
  const catalog: CatalogTableInfo[] = MERIDIA_CATALOG.map(
    ({ source: _source, ...table }) => table,
  );
  return (
    <Suspense fallback={<CanvasSkeleton />}>
      <CanvasWithData catalog={catalog} />
    </Suspense>
  );
}

async function CanvasWithData({ catalog }: { catalog: CatalogTableInfo[] }) {
  let conversations: ConversationSummary[] | null = null;
  let rules: RulesResponse | null = null;
  try {
    const [{ owner }, { mode }] = await Promise.all([
      requireOwner(),
      currentRequest(),
    ]);
    const services = canvas(mode);
    [conversations, rules] = await Promise.all([
      services.conversations.list(owner),
      services.rules.read(owner),
    ]);
  } catch (error) {
    // Next's own signals pass; without Access the client's reads say why.
    unstable_rethrow(error);
  }
  return (
    <Canvas
      catalog={catalog}
      initialConversations={conversations}
      initialRules={rules}
    />
  );
}
