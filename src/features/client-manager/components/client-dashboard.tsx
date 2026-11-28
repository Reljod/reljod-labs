"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { CatalogCard, ClientSummary } from "../domain/api";
import type { Highlight } from "../domain/traversal";
import { AddDialog } from "./add-dialog";
import { clientQuery, isGone, keys, stopBuild } from "./api";
import { BuildStrip } from "./build-strip";
import { DocumentsView, sourceQuery } from "./documents-view";
import { FactSheet } from "./fact-sheet";
import { Icon, type IconName } from "./icons";
import { Portrait } from "./portrait";
import { ProfileView } from "./profile-view";
import { DocumentSkeleton, MapSkeleton, ProfileSkeleton } from "./skeletons";
import { useBuildFeed } from "./use-build-feed";

export type DashboardView = "profile" | "map" | "documents";

const VIEWS: { id: DashboardView; label: string; icon: IconName }[] = [
  { id: "profile", label: "Profile", icon: "profile" },
  { id: "map", label: "Map", icon: "map" },
  { id: "documents", label: "Documents", icon: "doc" },
];

const RISK: Record<string, number> = { low: 1, moderate: 2, high: 3 };

// The Map's renderer (graph canvas, layout) loads when the Map is first
// opened, and starts loading when the pointer or focus reaches its tab.
const loadMap = () => import("./map-view");
const MapView = dynamic(() => loadMap().then((module) => module.MapView), {
  loading: () => <MapSkeleton />,
});

/**
 * One client: the business Profile first, the relationship Map and the
 * Documents behind every fact. Opens from the client's card at once and fills
 * in as each part loads.
 */
export function ClientDashboard({
  clientId,
  initialClient = null,
  loadedAt = 0,
  card,
  view,
  focusKey,
  doc,
  highlight,
  watchBuildId,
  onView,
  onFocus,
  onDoc,
  onAsk,
  onBack,
}: {
  clientId: string;
  /** The page's server read of this client, when it opened on it. */
  initialClient?: ClientSummary | null;
  loadedAt?: number;
  card: CatalogCard | undefined;
  view: DashboardView;
  focusKey: string | null;
  doc: { sourceId: string | null; quote: string | null };
  /** A chat answer's walk, lit on the map. */
  highlight: Highlight;
  watchBuildId: string | null;
  onView: (view: DashboardView) => void;
  onFocus: (key: string | null) => void;
  onDoc: (sourceId: string | null, quote?: string) => void;
  onAsk: (question: string, options?: { research?: boolean }) => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...clientQuery(clientId),
    ...(initialClient
      ? { initialData: initialClient, initialDataUpdatedAt: loadedAt }
      : {}),
  });
  const client = query.data;

  const running =
    client?.latestBuild &&
    ["queued", "running"].includes(client.latestBuild.status)
      ? client.latestBuild.id
      : null;
  const [watching, setWatching] = useState<string | null>(null);
  useEffect(() => {
    if (running) setWatching(running);
    else if (watchBuildId) setWatching(watchBuildId);
  }, [running, watchBuildId]);
  const live = useBuildFeed(watching, undefined);
  const buildOpen = !!watching && !live.end;
  const intake =
    client?.latestBuild?.id === watching &&
    client.latestBuild.trigger === "intake";

  // A Build that ended changes everything below: reload it.
  useEffect(() => {
    if (!live.end) return;
    void queryClient.invalidateQueries({ queryKey: keys.client(clientId) });
    void queryClient.invalidateQueries({
      queryKey: ["client-manager", "edges", clientId],
    });
    void queryClient.invalidateQueries({ queryKey: keys.catalog });
    const timer = setTimeout(() => setWatching(null), 2500);
    return () => clearTimeout(timer);
  }, [live.end, clientId, queryClient]);

  const [adding, setAdding] = useState(false);
  const name = client?.name ?? card?.name ?? "Client";
  const persona = live.persona ?? client?.persona ?? card?.persona ?? null;
  const portraitUrl =
    live.portraitUrl ?? client?.portraitUrl ?? card?.portraitUrl ?? null;

  // What a sub-tab shows first starts loading on hover or focus, so the
  // click finds it ready.
  const prefetchView = (next: DashboardView) => {
    if (next === "map") void loadMap();
    if (next === "documents" && client) {
      const sourceId = doc.sourceId ?? client.sources[0]?.id;
      if (sourceId)
        void queryClient.prefetchQuery(sourceQuery(client.id, sourceId));
    }
  };

  const openSource = (sourceId: string, quote?: string) => {
    onDoc(sourceId, quote);
    onView("documents");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-marble">
      <header className="border-ink border-b-2 bg-paper px-4 pt-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="All clients"
            className="outline-box press grid size-8 place-items-center rounded-sm bg-paper lg:hidden"
          >
            <Icon name="back" />
          </button>
          <Portrait
            name={name}
            url={portraitUrl}
            size="sm"
            building={buildOpen}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-mono text-lg leading-tight font-bold uppercase">
                {name}
              </h2>
              {(client?.isSample ?? card?.isSample) ? (
                <span className="eyebrow rounded-sm border border-ink bg-brass/30 px-1.5 py-0.5 text-[0.6rem] font-bold">
                  Sample
                </span>
              ) : null}
            </div>
            <p className="truncate text-sm text-ink-muted">
              {persona ? (
                <>
                  <span className="font-medium text-ink">
                    {persona.archetype}
                  </span>{" "}
                  · {persona.headline}
                </>
              ) : buildOpen ? (
                "Reading everything you shared…"
              ) : (
                " "
              )}
            </p>
          </div>
          <div className="hidden items-center gap-4 font-mono text-xs text-ink-muted sm:flex">
            {persona && persona.riskAppetite !== "unknown" ? (
              <span
                title={`Risk appetite: ${persona.riskAppetite}`}
                className="flex items-end gap-0.5"
              >
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`w-1 rounded-[1px] ${step <= (RISK[persona.riskAppetite] ?? 0) ? "bg-seal-red" : "bg-limestone"}`}
                    style={{ height: 4 + step * 3 }}
                  />
                ))}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <ToolButton
              icon="chat"
              label={`Ask about ${name} in Chat`}
              onClick={() => onAsk("")}
            />
            {client?.canAdd ? (
              <>
                <ToolButton
                  icon="globe"
                  label={`Research ${name} on the web`}
                  onClick={() => onAsk(`Research ${name}`, { research: true })}
                />
                <ToolButton
                  icon="add"
                  label="Add notes or files"
                  onClick={() => setAdding(true)}
                />
              </>
            ) : null}
          </div>
        </div>
        <nav
          aria-label="Client views"
          className="mt-3 mb-3 flex flex-wrap gap-2"
        >
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              onPointerEnter={() => prefetchView(item.id)}
              onFocus={() => prefetchView(item.id)}
              aria-current={view === item.id}
              className={`outline-box press eyebrow flex items-center gap-1.5 rounded-sm px-3 py-1.5 ${view === item.id ? "bg-ink text-paper" : "bg-paper"}`}
            >
              <Icon name={item.icon} className="size-3.5" />
              {item.label}
              {item.id === "documents" && client ? (
                <span className="opacity-60">{client.sources.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <AnimatePresence>
        {watching && (buildOpen || live.end) ? (
          <BuildStrip
            state={live}
            canStop={client?.canAdd ?? false}
            onStop={() =>
              stopBuild(watching).then(() =>
                queryClient.invalidateQueries({
                  queryKey: keys.client(clientId),
                }),
              )
            }
          />
        ) : null}
      </AnimatePresence>

      <div className="relative min-h-0 flex-1">
        {query.isError ? (
          <p className="p-8 text-center text-sm text-ink-muted">
            {isGone(query.error)
              ? "This client is gone, or belongs to someone else."
              : "This client didn't load. Try again."}
          </p>
        ) : !client ? (
          view === "map" ? (
            <MapSkeleton />
          ) : view === "documents" ? (
            <DocumentSkeleton />
          ) : (
            <ProfileSkeleton />
          )
        ) : (
          <motion.div
            key={view}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {view === "profile" ? (
              <>
                <ProfileView
                  client={client}
                  onFact={onFocus}
                  onResearch={(topic) =>
                    onAsk(`Research ${client.name}: ${topic.toLowerCase()}`, {
                      research: true,
                    })
                  }
                />
                <AnimatePresence>
                  {focusKey ? (
                    <div className="absolute top-3 right-3 bottom-3 z-10 w-[min(24rem,calc(100%-1.5rem))]">
                      <FactSheet
                        clientId={client.id}
                        clientName={client.name}
                        nodeKey={focusKey}
                        nodes={client.nodes}
                        sources={client.sources}
                        onSelect={onFocus}
                        onOpenSource={openSource}
                        onClose={() => onFocus(null)}
                      />
                    </div>
                  ) : null}
                </AnimatePresence>
              </>
            ) : view === "map" ? (
              <MapView
                client={client}
                live={intake && buildOpen ? live : null}
                focusKey={focusKey}
                highlight={highlight}
                onFocus={onFocus}
                onOpenSource={openSource}
              />
            ) : (
              <DocumentsView
                client={client}
                openId={doc.sourceId}
                quote={doc.quote}
                onOpen={(sourceId, quote) => onDoc(sourceId, quote)}
                onFact={(key) => {
                  onFocus(key);
                  onView("profile");
                }}
              />
            )}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {adding && client ? (
          <AddDialog
            clientId={client.id}
            clientName={client.name}
            onClose={() => setAdding(false)}
            onStarted={(buildId) => {
              setAdding(false);
              setWatching(buildId);
              void queryClient.invalidateQueries({
                queryKey: keys.client(clientId),
              });
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="outline-box press grid size-8 place-items-center rounded-sm bg-paper text-ink hover:text-federal-blue"
    >
      <Icon name={icon} />
    </button>
  );
}
