"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadSummary, Walk } from "../domain/chat";
import { EMPTY_HIGHLIGHT, highlightFrom } from "../domain/traversal";
import { fetchCatalog, fetchThreads, keys, send } from "./api";
import { Chat } from "./chat";
import { ClientDashboard, type DashboardView } from "./client-dashboard";
import { ClientsPanel } from "./clients-panel";
import { Icon, type IconName } from "./icons";
import { IntakeDialog } from "./intake-dialog";
import { ThreadList } from "./thread-list";
import "./client-manager.css";

type Tab = "chat" | "clients";

type Open = {
  clientId: string;
  view: DashboardView;
  focusKey: string | null;
  doc: { sourceId: string | null; quote: string | null };
  walk: Walk[] | null;
};

const opened = (clientId: string, patch: Partial<Open> = {}): Open => ({
  clientId,
  view: "profile",
  focusKey: null,
  doc: { sourceId: null, quote: null },
  walk: null,
  ...patch,
});

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "clients", label: "Clients", icon: "people" },
];

/**
 * Client Manager in two tabs. Chat: every conversation on the left, the
 * desk beside it. Clients: the book on the left, the open client's file
 * beside it, with no chat in the way. A fact cited in Chat opens in
 * Clients; "Ask" on a client goes back to Chat, scoped to them.
 */
export function ClientManagerApp({
  initialThreadId = null,
  initialClientId = null,
}: {
  initialThreadId?: string | null;
  initialClientId?: string | null;
}) {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: keys.catalog,
    queryFn: fetchCatalog,
    refetchInterval: (current) =>
      current.state.data?.some(
        (card) => card.building || card.status === "building",
      )
        ? 4000
        : false,
  });
  const threads = useQuery({ queryKey: keys.threads, queryFn: fetchThreads });
  const cards = catalog.data ?? [];

  const [tab, setTab] = useState<Tab>(initialClientId ? "clients" : "chat");
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [scope, setScope] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(
    initialClientId ? opened(initialClientId) : null,
  );
  // On small screens each tab shows its list or its main pane, not both.
  const [showList, setShowList] = useState(
    !initialClientId && !initialThreadId,
  );
  const [sidebar, setSidebar] = useState(true);
  const [adding, setAdding] = useState(false);
  const [seed, setSeed] = useState<{
    id: number;
    text: string;
    research: boolean;
  } | null>(null);

  // An opened thread brings its scope with it.
  const activeThread = threads.data?.find((thread) => thread.id === threadId);
  useEffect(() => {
    if (activeThread) setScope(activeThread.clientId);
  }, [activeThread]);

  // The address follows what is open, so a reload or a shared link lands there.
  useEffect(() => {
    const path =
      tab === "clients" && open
        ? `/demos/client-manager/${open.clientId}`
        : "/demos/client-manager";
    const next = `${path}${tab === "chat" && threadId ? `?t=${threadId}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, "", next);
  }, [tab, threadId, open]);

  const goTo = (next: Tab) => {
    setTab(next);
    setShowList(false);
  };

  const showClient = useCallback(
    (clientId: string, patch: Partial<Open> = {}) => {
      setOpen((current) =>
        current?.clientId === clientId
          ? { ...current, ...patch }
          : opened(clientId, patch),
      );
      setTab("clients");
      setShowList(false);
    },
    [],
  );

  const changeScope = useCallback(
    (clientId: string | null) => {
      setScope(clientId);
      if (threadId) {
        void send(`/api/client-manager/threads/${threadId}`, "PATCH", {
          clientId,
        }).then(() =>
          queryClient.invalidateQueries({ queryKey: keys.threads }),
        );
      }
    },
    [queryClient, threadId],
  );

  const askAbout = useCallback(
    (clientId: string, text: string, research = false) => {
      setThreadId(null);
      setScope(clientId);
      setTab("chat");
      setShowList(false);
      setSeed({ id: Date.now(), text, research });
    },
    [],
  );

  const highlight = useMemo(
    () =>
      open?.walk
        ? highlightFrom(open.walk.map((walk) => walk.step))
        : EMPTY_HIGHLIGHT,
    [open],
  );

  // Threads being deleted now, so a second click cannot send it twice.
  const deleting = useRef(new Set<string>());
  const [threadNotice, setThreadNotice] = useState<string | null>(null);
  const deleteThread = async (thread: ThreadSummary) => {
    if (deleting.current.has(thread.id)) return;
    if (!window.confirm(`Delete “${thread.title}”?`)) return;
    deleting.current.add(thread.id);
    setThreadNotice(null);
    // Gone from the list at once; put back below if the server refuses.
    queryClient.setQueryData<ThreadSummary[]>(keys.threads, (list) =>
      (list ?? []).filter((item) => item.id !== thread.id),
    );
    if (thread.id === threadId) setThreadId(null);
    try {
      await send(`/api/client-manager/threads/${thread.id}`, "DELETE");
    } catch (failure) {
      setThreadNotice(
        `“${thread.title}” was not deleted: ${failure instanceof Error ? failure.message : "try again."}`,
      );
    } finally {
      deleting.current.delete(thread.id);
      void queryClient.invalidateQueries({ queryKey: keys.threads });
    }
  };

  const patchOpen = (patch: Partial<Open>) =>
    setOpen((current) => (current ? { ...current, ...patch } : current));

  return (
    <div className="flex h-dvh flex-col bg-marble text-ink">
      <header className="flex items-center gap-3 border-ink/10 border-b bg-paper px-3 py-2">
        <button
          type="button"
          onClick={() => setSidebar(!sidebar)}
          aria-label={sidebar ? "Hide the list" : "Show the list"}
          className="hidden rounded-sm p-1.5 text-ink-muted hover:bg-marble hover:text-ink lg:block"
        >
          <Icon name="sidebar" />
        </button>
        <button
          type="button"
          onClick={() => setShowList(!showList)}
          aria-label={showList ? "Hide the list" : "Show the list"}
          className="rounded-sm p-1.5 text-ink-muted hover:bg-marble hover:text-ink lg:hidden"
        >
          <Icon name="sidebar" />
        </button>
        <Link
          href="/#demos"
          className="hidden text-sm text-ink-muted hover:text-ink sm:inline"
        >
          Demos
        </Link>
        <span className="hidden text-stone sm:inline">/</span>
        <h1 className="hidden font-mono text-sm font-bold tracking-[0.06em] uppercase sm:block">
          Client Manager
        </h1>
        <div
          aria-label="Sections"
          role="tablist"
          className="mx-auto flex rounded-full bg-marble p-1 sm:mx-0 sm:ml-6"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => goTo(item.id)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${tab === item.id ? "bg-ink text-paper" : "text-ink-muted hover:text-ink"}`}
            >
              <Icon name={item.icon} className="size-3.5" />
              {item.label}
            </button>
          ))}
        </div>
        <Link
          href="/demos/client-manager/mcp"
          className="ml-auto hidden items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm text-ink-muted hover:bg-marble hover:text-federal-blue sm:flex"
        >
          <Icon name="plug" className="size-4" />
          MCP
        </Link>
      </header>

      {tab === "chat" ? (
        <div className="flex min-h-0 flex-1">
          {sidebar ? (
            <aside
              className={`${showList ? "flex" : "hidden"} w-full shrink-0 flex-col border-ink/10 bg-marble lg:flex lg:w-64 lg:border-r`}
            >
              <ThreadList
                threads={threads.data ?? []}
                cards={cards}
                activeId={threadId}
                loading={threads.isLoading}
                onNew={() => {
                  setThreadId(null);
                  setScope(null);
                  setShowList(false);
                }}
                onOpen={(thread) => {
                  setThreadId(thread.id);
                  setScope(thread.clientId);
                  setShowList(false);
                }}
                onDelete={(thread) => void deleteThread(thread)}
                notice={threadNotice}
              />
            </aside>
          ) : null}
          <main
            className={`${showList ? "hidden" : "flex"} min-w-0 flex-1 flex-col bg-paper/40 lg:flex`}
          >
            <Chat
              threadId={threadId}
              scope={scope}
              cards={cards}
              seed={seed}
              onScope={changeScope}
              onThreadCreated={(thread) => {
                setThreadId(thread.id);
                void queryClient.invalidateQueries({ queryKey: keys.threads });
              }}
              onOpenFact={(clientId, key) =>
                showClient(clientId, { focusKey: key, view: "profile" })
              }
              onOpenClient={(clientId) => showClient(clientId)}
              onShowWalk={(clientId, walks) =>
                showClient(clientId, {
                  view: "map",
                  walk: walks,
                  focusKey: null,
                })
              }
            />
          </main>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {sidebar ? (
            <aside
              className={`${showList || !open ? "flex" : "hidden"} w-full shrink-0 flex-col border-ink/10 bg-marble lg:flex lg:w-80 lg:border-r`}
            >
              <ClientsPanel
                cards={cards}
                loading={catalog.isLoading}
                activeId={open?.clientId ?? null}
                onOpen={(clientId) =>
                  showClient(clientId, { view: "profile", focusKey: null })
                }
                onAsk={(clientId) => askAbout(clientId, "")}
                onAdd={() => setAdding(true)}
              />
            </aside>
          ) : null}
          <main
            className={`${showList || !open ? "hidden" : "flex"} min-w-0 flex-1 flex-col lg:flex`}
          >
            {open ? (
              <ClientDashboard
                key={open.clientId}
                clientId={open.clientId}
                card={cards.find((card) => card.id === open.clientId)}
                view={open.view}
                focusKey={open.focusKey}
                doc={open.doc}
                highlight={highlight}
                watchBuildId={null}
                onView={(view) => patchOpen({ view })}
                onFocus={(focusKey) => patchOpen({ focusKey })}
                onDoc={(sourceId, quote) =>
                  patchOpen({ doc: { sourceId, quote: quote ?? null } })
                }
                onAsk={(text, options) =>
                  askAbout(open.clientId, text, options?.research)
                }
                onBack={() => {
                  setOpen(null);
                  setShowList(true);
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-ink-muted">
                <Icon name="people" className="size-8 text-stone" />
                <p>Pick a client to open their file.</p>
              </div>
            )}
          </main>
        </div>
      )}

      <AnimatePresence>
        {adding ? (
          <IntakeDialog
            onClose={() => setAdding(false)}
            onCreated={(clientId) => {
              setAdding(false);
              void queryClient.invalidateQueries({ queryKey: keys.catalog });
              showClient(clientId, { view: "map" });
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
