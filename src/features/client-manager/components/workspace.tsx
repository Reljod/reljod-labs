"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRANCHES, toneOf } from "../domain/categories";
import type { ChatEvent, TraversalStep } from "../domain/events";
import { type AppliedRepair, ROOT_KEY } from "../domain/graph";
import {
  EMPTY_HIGHLIGHT,
  type Highlight,
  highlightFrom,
} from "../domain/traversal";
import type { ClientView } from "../server/service";
import { CategoryTree } from "./category-tree";
import {
  type AskState,
  ChatPanel,
  type ToolLineState,
  type Working,
} from "./chat-panel";
import { type CameraTarget, GraphCanvas } from "./graph-canvas";
import { readNdjson } from "./ndjson";
import { NodeDrawer } from "./node-drawer";
import { Portrait } from "./portrait";
import { metaOf, postJson, putFile } from "./upload";
import { useBuildFeed } from "./use-build-feed";

async function fetchClient(clientId: string): Promise<ClientView> {
  const response = await fetch(`/api/client-manager/clients/${clientId}`, {
    cache: "no-store",
  });
  if (response.status === 404) throw new Error("not-found");
  if (!response.ok) throw new Error("Could not load this client");
  return response.json();
}

const CALLOUT: Record<AppliedRepair["op"], { text: string; tone: string }> = {
  remove_node: { text: "removed", tone: "#b23a2b" },
  merge_nodes: { text: "merged", tone: "#1d4e89" },
  move_node: { text: "moved", tone: "#6b4226" },
  update_node: { text: "reworded", tone: "#4a4f5b" },
  resolve_conflict: { text: "settled", tone: "#d9a84e" },
  add_edge: { text: "linked", tone: "#2f6b3f" },
  remove_edge: { text: "unlinked", tone: "#b23a2b" },
};

export function Workspace({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["client-manager", "client", clientId],
    queryFn: () => fetchClient(clientId),
    retry: (count, error) => error.message !== "not-found" && count < 2,
  });
  const view = query.data;

  // The Build this page is watching: the one running when it opened, or one it started.
  const [watching, setWatching] = useState<string | null>(null);
  const running =
    view?.latestBuild && ["queued", "running"].includes(view.latestBuild.status)
      ? view.latestBuild.id
      : null;
  const liveBuildId = watching ?? running;
  const base =
    view?.latestBuild?.trigger === "addition" || watching
      ? view?.graph
      : undefined;
  const live = useBuildFeed(liveBuildId, base);
  const buildOpen = !!liveBuildId && !live.end;

  useEffect(() => {
    if (running && !watching) setWatching(running);
  }, [running, watching]);

  useEffect(() => {
    if (live.end)
      void queryClient.invalidateQueries({
        queryKey: ["client-manager", "client", clientId],
      });
  }, [live.end, clientId, queryClient]);

  // While the committed graph catches up with a Build that just ended, keep drawing the live one.
  const committedCurrent =
    !liveBuildId ||
    (view?.latestBuild?.id === liveBuildId &&
      view.latestBuild.status !== "running" &&
      view.latestBuild.status !== "queued" &&
      !!live.end);
  const graph = !view
    ? { nodes: [], edges: [] }
    : committedCurrent
      ? view.graph
      : live.graph;
  const portraitUrl = live.portraitUrl ?? view?.portraitUrl ?? null;
  const persona = live.persona ?? view?.persona ?? null;

  const [target, setTarget] = useState<CameraTarget>({ kind: "overview" });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(EMPTY_HIGHLIGHT);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  const [asking, setAsking] = useState<AskState | null>(null);
  const [mobileTab, setMobileTab] = useState<"graph" | "chat">("graph");
  const replayTimer = useRef<ReturnType<typeof setTimeout>[]>([]);

  const labelOf = useCallback(
    (key: string) =>
      key === ROOT_KEY
        ? (view?.name ?? "Client")
        : (graph.nodes.find((node) => node.key === key)?.label ??
          key.split(":")[1]?.replace(/-/g, " ") ??
          key),
    [graph.nodes, view?.name],
  );
  const toneFor = useCallback(
    (key: string) =>
      toneOf(
        graph.nodes.find((node) => node.key === key)?.category ??
          "profile.personal",
      ),
    [graph.nodes],
  );

  const select = useCallback((key: string | null) => {
    setSelected(key);
    if (key) {
      setTarget({ kind: "node", key });
      setMobileTab("graph");
    }
  }, []);

  const focusTarget = useCallback((next: CameraTarget) => {
    setSelected(null);
    setTarget(next);
  }, []);

  const showSteps = useCallback(
    (steps: TraversalStep[]) => {
      const lit = highlightFrom(steps);
      setHighlight(lit);
      if (follow && steps.length > 0) {
        setSelected(null);
        setTarget({ kind: "keys", keys: [...lit.nodes.keys()] });
      }
    },
    [follow],
  );

  const replay = useCallback(
    (steps: TraversalStep[]) => {
      for (const timer of replayTimer.current) clearTimeout(timer);
      replayTimer.current = steps.map((_, index) =>
        setTimeout(() => showSteps(steps.slice(0, index + 1)), index * 900),
      );
      setHighlight(EMPTY_HIGHLIGHT);
      setMobileTab("graph");
    },
    [showSteps],
  );
  useEffect(
    () => () => {
      for (const timer of replayTimer.current) clearTimeout(timer);
    },
    [],
  );

  const askAbort = useRef<AbortController | null>(null);
  const ask = useCallback(
    async (question: string) => {
      askAbort.current?.abort();
      const controller = new AbortController();
      askAbort.current = controller;
      setHighlight(EMPTY_HIGHLIGHT);
      setSelected(null);
      let current: AskState = {
        question,
        tools: [],
        reasoning: "",
        text: "",
        done: false,
        error: null,
        costUsd: null,
        buildId: null,
        startedAt: Date.now(),
      };
      setAsking(current);
      const update = (patch: Partial<AskState>) => {
        current = { ...current, ...patch };
        setAsking(current);
      };
      const patchTool = (
        callId: string | undefined,
        patch: Partial<ToolLineState>,
      ) => {
        const index = callId
          ? current.tools.findIndex((tool) => tool.callId === callId)
          : current.tools.findLastIndex((tool) => !tool.entry);
        if (index < 0) return;
        const tools = [...current.tools];
        tools[index] = { ...tools[index], ...patch } as ToolLineState;
        update({ tools });
      };
      try {
        const response = await fetch(
          `/api/client-manager/clients/${clientId}/chat`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: question }),
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error("The Navigator is unavailable right now.");
        let cost = 0;
        for await (const event of readNdjson<ChatEvent>(response)) {
          if (event.type === "tool") {
            update({
              tools: [
                ...current.tools,
                { callId: event.callId, name: event.name, input: event.input },
              ],
            });
          } else if (event.type === "step") {
            patchTool(event.callId, {
              entry: { step: event.step, sql: event.sql, ms: event.ms },
            });
            showSteps(
              current.tools.flatMap((tool) =>
                tool.entry ? [tool.entry.step] : [],
              ),
            );
          } else if (event.type === "tool-result") {
            patchTool(event.callId, { ok: event.ok, summary: event.summary });
          } else if (event.type === "reasoning") {
            update({ reasoning: current.reasoning + event.delta });
          } else if (event.type === "text") {
            update({ text: current.text + event.delta });
          } else if (event.type === "usage") {
            cost += event.usage.costUsd ?? 0;
            update({ costUsd: cost });
          } else if (event.type === "build") {
            update({ buildId: event.buildId });
            setWatching(event.buildId);
          } else if (event.type === "error") {
            update({ error: event.message });
          } else if (event.type === "done") {
            update({ done: true });
            if (event.cited.length > 0) {
              const next = highlightFrom(
                current.tools.flatMap((tool) =>
                  tool.entry ? [tool.entry.step] : [],
                ),
              );
              for (const key of event.cited) {
                const node = next.nodes.get(key);
                next.nodes.set(key, {
                  glow: "path",
                  order: node?.order ?? next.nodes.size,
                  depth: node?.depth ?? 0,
                });
              }
              setHighlight(next);
              if (followRef.current)
                setTarget({ kind: "keys", keys: event.cited });
            }
          }
        }
        update({ done: true });
      } catch (failure) {
        const stopped = controller.signal.aborted;
        update({
          done: true,
          error: stopped
            ? "Stopped."
            : failure instanceof Error
              ? failure.message
              : "Something went wrong.",
        });
        if (stopped) return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["client-manager", "client", clientId],
      });
      setAsking((value) => (value === current ? null : value));
    },
    [clientId, queryClient, showSteps],
  );

  const add = useCallback(
    async (note: string, files: File[]) => {
      const created = await postJson<{
        buildId: string;
        uploads: { sourceId: string; name: string; url: string }[];
      }>(`/api/client-manager/clients/${clientId}/builds`, {
        note,
        files: files.map(metaOf),
      });
      await Promise.all(
        created.uploads.map((upload) => {
          const file = files.find((item) => item.name === upload.name);
          return file ? putFile(upload.url, file) : Promise.resolve();
        }),
      );
      await postJson(`/api/client-manager/builds/${created.buildId}/start`, {});
      await queryClient.invalidateQueries({
        queryKey: ["client-manager", "client", clientId],
      });
      setHighlight(EMPTY_HIGHLIGHT);
      setWatching(created.buildId);
    },
    [clientId, queryClient],
  );

  const send = useCallback(
    (text: string, files: File[]) => {
      if (files.length > 0) {
        add(text, files).catch((failure: unknown) => {
          setAsking({
            question: text || files.map((file) => file.name).join(", "),
            tools: [],
            reasoning: "",
            text: "",
            done: true,
            error:
              failure instanceof Error
                ? failure.message
                : "Could not add those files.",
            costUsd: null,
            buildId: null,
            startedAt: Date.now(),
          });
        });
        return;
      }
      void ask(text);
    },
    [add, ask],
  );

  const stop = useCallback(() => {
    if (asking && !asking.done) {
      askAbort.current?.abort();
      return;
    }
    if (liveBuildId && !live.end) {
      void postJson(`/api/client-manager/builds/${liveBuildId}/stop`, {}).then(
        () =>
          queryClient.invalidateQueries({
            queryKey: ["client-manager", "client", clientId],
          }),
      );
    }
  }, [asking, clientId, live.end, liveBuildId, queryClient]);

  const liveSpend = live.usages.reduce(
    (sum, usage) => sum + (usage.costUsd ?? 0),
    0,
  );
  const working: Working =
    asking && !asking.done
      ? {
          label:
            asking.tools.length > 0
              ? `Walking the graph · ${asking.tools.at(-1)?.name.replace("_", " ")}`
              : "Thinking",
          costUsd: asking.costUsd ?? 0,
          since: asking.startedAt,
        }
      : liveBuildId && !live.end && (view?.canAdd ?? false)
        ? {
            label: live.runs.at(-1)
              ? `Building · ${live.runs.at(-1)?.job}${live.runs.at(-1)?.round ? ` round ${live.runs.at(-1)?.round}` : ""}`
              : "Building · starting",
            costUsd: liveSpend,
            since: live.runs[0]?.startedAt ?? Date.now(),
          }
        : null;
  const workingRef = useRef(false);
  workingRef.current = !!working;

  // Repairs float a label over the Nodes they touched for a few seconds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!buildOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 900);
    return () => clearInterval(timer);
  }, [buildOpen]);
  const recent = useMemo(
    () =>
      live.repairs
        .slice(-6)
        .map(({ repair, at }) => ({
          keys: repair.op === "merge_nodes" ? [repair.keep] : repair.touches,
          text: CALLOUT[repair.op].text,
          tone: CALLOUT[repair.op].tone,
          at,
        }))
        .filter((item) => now - item.at < 5200),
    [live.repairs, now],
  );

  // Esc steps back out a level.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // While something runs, Escape belongs to Stop (the chat handles it).
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        workingRef.current
      )
        return;
      if (selected) setSelected(null);
      else if (target.kind === "leaf")
        setTarget({ kind: "branch", id: target.id.split(".")[0] ?? "" });
      else setTarget({ kind: "overview" });
      if (!selected && target.kind === "overview")
        setHighlight(EMPTY_HIGHLIGHT);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, target]);

  if (query.isError) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
        <p className="font-mono text-2xl font-bold uppercase">
          Client not found
        </p>
        <p className="text-ink-muted">
          It may belong to another browser session, or it has expired.
        </p>
        <Link
          href="/demos/client-manager"
          className="outline-box press rounded-sm bg-federal-blue px-4 py-2 font-mono text-sm font-bold text-paper uppercase"
        >
          Back to the Catalog
        </Link>
      </div>
    );
  }
  if (!view) return <WorkspaceSkeleton />;

  const breadcrumb = [
    { label: view.name, target: { kind: "overview" } as CameraTarget },
    ...(target.kind === "branch" || target.kind === "leaf"
      ? [
          {
            label:
              BRANCHES.find(
                (branch) =>
                  branch.id ===
                  (target.kind === "branch"
                    ? target.id
                    : target.id.split(".")[0]),
              )?.label ?? "",
            target: {
              kind: "branch",
              id:
                target.kind === "branch"
                  ? target.id
                  : (target.id.split(".")[0] ?? ""),
            } as CameraTarget,
          },
        ]
      : []),
    ...(target.kind === "leaf"
      ? [
          {
            label:
              BRANCHES.flatMap((branch) =>
                branch.leaves.map((leaf) => ({
                  id: `${branch.id}.${leaf.id}`,
                  label: leaf.label,
                })),
              ).find((leaf) => leaf.id === target.id)?.label ?? "",
            target,
          },
        ]
      : []),
    ...(selected
      ? [
          {
            label: labelOf(selected),
            target: { kind: "node", key: selected } as CameraTarget,
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-dvh flex-col bg-marble">
      <WorkspaceHeader
        view={view}
        portraitUrl={portraitUrl}
        persona={persona}
        building={buildOpen}
        nodes={graph.nodes.length}
        edges={graph.edges.length}
        onPortrait={() =>
          queryClient.invalidateQueries({
            queryKey: ["client-manager", "client", clientId],
          })
        }
      />

      <div
        className="flex border-ink border-b-2 bg-paper lg:hidden"
        role="tablist"
        aria-label="View"
      >
        {(["graph", "chat"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mobileTab === tab}
            onClick={() => setMobileTab(tab)}
            className={`eyebrow flex-1 py-2.5 font-bold ${mobileTab === tab ? "bg-ink text-paper" : ""}`}
          >
            {tab === "graph"
              ? "Graph"
              : `Chat${asking && !asking.done ? " ·" : ""}`}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[15rem_minmax(0,1fr)_26rem]">
        <aside className="hidden min-h-0 overflow-y-auto border-ink border-r-2 bg-marble p-3 lg:block">
          <CategoryTree
            graph={graph}
            target={target}
            highlight={highlight}
            onTarget={focusTarget}
            onSelect={select}
          />
          <div className="mt-6 space-y-2 border-ink border-t-2 pt-3">
            <p className="eyebrow font-bold">
              Sources ·{" "}
              {view.sources.length +
                (buildOpen
                  ? live.sources.filter(
                      (source) =>
                        !view.sources.some((item) => item.id === source.id),
                    ).length
                  : 0)}
            </p>
            <ul className="space-y-1 text-xs">
              {view.sources.map((source) => (
                <li
                  key={source.id}
                  className="flex items-center gap-1.5 truncate text-ink-muted"
                >
                  <span className="outline-box rounded-sm bg-paper px-1 font-mono text-[0.55rem] font-bold uppercase">
                    {source.kind}
                  </span>
                  <span className="truncate">{source.name}</span>
                </li>
              ))}
            </ul>
            <p className="eyebrow pt-2 text-[0.6rem] text-stone">
              Spend so far ${view.spend.costUsd.toFixed(3)} ·{" "}
              {view.spend.tokens.toLocaleString("en-US")} tokens
            </p>
          </div>
        </aside>

        <div
          className={`relative min-h-0 ${mobileTab === "graph" ? "block" : "hidden"} h-[calc(100dvh-10rem)] lg:block lg:h-auto`}
        >
          <GraphCanvas
            graph={graph}
            clientName={view.name}
            portraitUrl={portraitUrl}
            highlight={highlight}
            target={target}
            selected={selected}
            hovered={hovered}
            building={buildOpen}
            arrivals={buildOpen ? live.arrivals : undefined}
            departures={live.departures}
            recent={recent}
            onTarget={focusTarget}
            onSelect={select}
          />
          <nav
            aria-label="Where you are"
            className="pointer-events-none absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1"
          >
            {breadcrumb.map((crumb, index) => (
              <span
                key={`${crumb.label}-${index}`}
                className="pointer-events-auto flex items-center gap-1"
              >
                {index > 0 ? (
                  <span className="font-mono text-stone">›</span>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    crumb.target.kind === "node"
                      ? null
                      : focusTarget(crumb.target)
                  }
                  className={`outline-box eyebrow max-w-[12rem] truncate rounded-sm px-2 py-1 font-bold ${index === breadcrumb.length - 1 ? "bg-ink text-paper" : "bg-paper hover:bg-morning-haze"}`}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </nav>
          <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
            <label className="outline-box eyebrow flex cursor-pointer items-center gap-2 rounded-sm bg-paper px-2 py-1 font-bold">
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
                className="accent-federal-blue"
              />
              Follow the walk
            </label>
            {highlight.nodes.size > 0 ? (
              <button
                type="button"
                onClick={() => setHighlight(EMPTY_HIGHLIGHT)}
                className="outline-box eyebrow rounded-sm bg-paper px-2 py-1 font-bold hover:bg-morning-haze"
              >
                Clear trail
              </button>
            ) : null}
          </div>
          <AnimatePresence>
            {buildOpen ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="outline-box absolute bottom-3 left-3 flex items-center gap-3 rounded-sm bg-ink px-3 py-2 text-paper shadow-hard-md"
              >
                <span className="relative flex size-3">
                  <span className="absolute inset-0 rounded-full bg-brass motion-safe:animate-ping" />
                  <span className="relative size-3 rounded-full bg-brass" />
                </span>
                <span className="font-mono text-xs font-bold tracking-[0.08em] uppercase">
                  {live.runs.at(-1)
                    ? `${live.runs.at(-1)?.job}${live.runs.at(-1)?.round ? ` · round ${live.runs.at(-1)?.round}` : ""}`
                    : "starting"}{" "}
                  · {graph.nodes.length} nodes
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {selected ? (
              <div className="absolute top-14 right-3 bottom-3 z-10 w-[min(22rem,calc(100%-1.5rem))]">
                <NodeDrawer
                  nodeKey={selected}
                  graph={graph}
                  sources={[...view.sources, ...live.sources]}
                  clientName={view.name}
                  onSelect={select}
                  onClose={() => setSelected(null)}
                />
              </div>
            ) : null}
          </AnimatePresence>
        </div>

        <div
          className={`min-h-0 border-ink lg:border-l-2 ${mobileTab === "chat" ? "block h-[calc(100dvh-10rem)]" : "hidden"} lg:block lg:h-auto`}
        >
          <ChatPanel
            view={view}
            live={liveBuildId ? live : null}
            liveBuildId={liveBuildId}
            asking={asking}
            working={working}
            labelOf={labelOf}
            toneFor={toneFor}
            onSend={send}
            onStop={stop}
            onReplay={replay}
            onCite={(key) => select(key)}
            onHover={setHovered}
          />
        </div>
      </div>
    </div>
  );
}

function WorkspaceHeader({
  view,
  portraitUrl,
  persona,
  building,
  nodes,
  edges,
  onPortrait,
}: {
  view: ClientView;
  portraitUrl: string | null;
  persona: ClientView["persona"];
  building: boolean;
  nodes: number;
  edges: number;
  onPortrait: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const repaint = async () => {
    setBusy("Painting…");
    setMenu(false);
    try {
      await postJson(`/api/client-manager/clients/${view.id}/portrait`, {
        mode: "paint",
      });
      onPortrait();
    } finally {
      setBusy(null);
    }
  };
  const uploadPortrait = async (file: File) => {
    setBusy("Uploading…");
    setMenu(false);
    try {
      const { url, path } = await postJson<{ url: string; path: string }>(
        `/api/client-manager/clients/${view.id}/portrait`,
        { mode: "upload", name: file.name, type: file.type || "image/jpeg" },
      );
      await putFile(url, file);
      await postJson(`/api/client-manager/clients/${view.id}/portrait`, {
        mode: "confirm",
        path,
      });
      onPortrait();
    } finally {
      setBusy(null);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-ink border-b-2 bg-paper px-4 py-3">
      <Link
        href="/demos/client-manager"
        className="eyebrow outline-box press rounded-sm bg-paper px-2 py-1 font-bold"
      >
        ← Catalog
      </Link>
      <div className="relative">
        <button
          type="button"
          onClick={() => view.canAdd && setMenu(!menu)}
          aria-label="Portrait options"
          aria-expanded={menu}
          disabled={!view.canAdd}
          className="rounded-full"
        >
          <Portrait
            name={view.name}
            url={portraitUrl}
            size="md"
            building={building || !!busy}
          />
        </button>
        <AnimatePresence>
          {menu ? (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="outline-box absolute top-full left-0 z-30 mt-2 w-48 rounded-sm bg-paper shadow-hard-md"
            >
              <button
                type="button"
                onClick={repaint}
                disabled={!persona}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-morning-haze disabled:opacity-40"
              >
                Repaint from persona
              </button>
              <button
                type="button"
                onClick={() => picker.current?.click()}
                className="block w-full border-ink border-t-2 px-3 py-2 text-left text-sm hover:bg-morning-haze"
              >
                Upload a photo
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadPortrait(file);
            event.target.value = "";
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl leading-none font-bold uppercase sm:text-2xl">
            {view.name}
          </h1>
          {view.isSample ? (
            <span className="eyebrow outline-box rounded-sm bg-brass px-1.5 py-0.5 font-bold">
              Sample
            </span>
          ) : null}
          {busy ? (
            <span className="eyebrow text-federal-blue">{busy}</span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm text-ink-muted">
          {persona ? (
            <>
              <span className="font-semibold text-ink">
                {persona.archetype}
              </span>{" "}
              · {persona.headline}
            </>
          ) : building ? (
            "Reading everything you shared…"
          ) : (
            "No persona yet"
          )}
        </p>
      </div>
      <dl className="hidden items-center gap-4 font-mono text-xs md:flex">
        {[
          { label: "Nodes", value: nodes },
          { label: "Edges", value: edges },
          { label: "Risk", value: persona?.riskAppetite ?? "—" },
        ].map((item) => (
          <div key={item.label} className="text-center">
            <dt className="eyebrow text-[0.6rem] text-ink-muted">
              {item.label}
            </dt>
            <dd className="text-lg font-bold uppercase tabular-nums">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {persona?.traits?.length ? (
        <ul className="hidden w-full flex-wrap gap-1.5 xl:flex xl:w-auto">
          {persona.traits.map((trait) => (
            <li
              key={trait}
              className="eyebrow outline-box rounded-sm bg-morning-haze px-2 py-0.5"
            >
              {trait}
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center gap-4 border-ink border-b-2 bg-paper px-4 py-3">
        <div className="cm-shimmer size-16 rounded-full" />
        <div className="space-y-2">
          <div className="cm-shimmer h-5 w-48 rounded-sm" />
          <div className="cm-shimmer h-3 w-72 rounded-sm" />
        </div>
      </div>
      <div className="cm-shimmer flex-1" />
    </div>
  );
}
