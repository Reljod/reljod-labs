import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { Canvas } from "@/features/canvas/components/canvas";
import { CanvasSkeleton } from "@/features/canvas/components/skeleton";
import type {
  CatalogTableInfo,
  RulesResponse,
} from "@/features/canvas/domain/api";
import type { ConversationSummary } from "@/features/canvas/domain/chat";
import { CATALOG } from "@/features/canvas/domain/data";
import { requireCaller } from "@/features/canvas/server/caller";
import { listConversations } from "@/features/canvas/server/conversations";
import {
  currentRulebook,
  rulebookHistory,
} from "@/features/canvas/server/rules";

export const metadata: Metadata = {
  title: "Canvas · Demo",
  description:
    "An analyst that answers a question about a million rows with a working interface: charts with controls delivered as MCP Apps, queries run in a sandbox, and every narrated number recomputed by code.",
};

/*
 * The Catalog is seed data, built into the static shell. The Owner's
 * Conversations and Rulebook come from the request's cookies, so they are
 * read behind Suspense (`cacheComponents` is on) and handed down. The Access
 * gate runs in `src/proxy.ts`, here, and again in every route and action.
 */
export default function CanvasDemoPage() {
  const catalog: CatalogTableInfo[] = CATALOG.map((table) => ({
    name: table.name,
    title: table.title,
    description: table.description,
    group: table.group,
    grain: table.grain,
    rows: table.rows,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      description: column.description,
      ...(column.unit ? { unit: column.unit } : {}),
    })),
  }));
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
    const caller = await requireCaller();
    const [list, current, history] = await Promise.all([
      listConversations(caller),
      currentRulebook(caller.owner),
      rulebookHistory(caller.owner),
    ]);
    conversations = list;
    rules = {
      version: current.version,
      rulebook: current.rulebook,
      savedAt: current.savedAt,
      history,
    };
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
