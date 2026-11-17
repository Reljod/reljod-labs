"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ThreadSummary } from "../domain/chat";
import type { CatalogCard } from "../server/service";
import { Icon } from "./icons";
import { Portrait } from "./portrait";

type Grouping = "recent" | "client";

const DAY = 86_400_000;

function bucketOf(updatedAt: string, now: number) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const at = Date.parse(updatedAt);
  if (at >= startOfToday) return "Today";
  if (at >= startOfToday - DAY) return "Yesterday";
  if (at >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (at >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}

/** Every chat of yours: new, search, by date or by client. */
export function ThreadList({
  threads,
  cards,
  activeId,
  loading,
  onNew,
  onOpen,
  onDelete,
  notice = null,
}: {
  threads: ThreadSummary[];
  cards: CatalogCard[];
  activeId: string | null;
  loading: boolean;
  onNew: () => void;
  onOpen: (thread: ThreadSummary) => void;
  onDelete: (thread: ThreadSummary) => void;
  /** Why the last delete did not go through, shown above the list. */
  notice?: string | null;
}) {
  const [filter, setFilter] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("recent");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) =>
      [thread.title, thread.preview, thread.clientName]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [threads, filter]);

  const groups = useMemo(() => {
    const now = Date.now();
    const map = new Map<
      string,
      { title: string; clientId: string | null; threads: ThreadSummary[] }
    >();
    for (const thread of visible) {
      const id =
        grouping === "recent"
          ? bucketOf(thread.updatedAt, now)
          : (thread.clientId ?? "all");
      const title =
        grouping === "recent" ? id : (thread.clientName ?? "All clients");
      const group =
        map.get(id) ??
        map
          .set(id, {
            title,
            clientId: grouping === "client" ? thread.clientId : null,
            threads: [],
          })
          .get(id);
      group?.threads.push(thread);
    }
    return [...map.values()];
  }, [visible, grouping]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 p-3">
        <button
          type="button"
          onClick={onNew}
          className="outline-box press eyebrow flex w-full items-center gap-2 rounded-sm bg-federal-blue px-3 py-2 font-bold text-paper"
        >
          <Icon name="plus" className="size-4" />
          New chat
        </button>
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone"
          />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search chats"
            className="outline-box w-full rounded-sm bg-paper py-1.5 pr-2 pl-8 text-sm shadow-hard-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
          />
        </label>
        <div
          className="grid grid-cols-2 gap-2"
          role="tablist"
          aria-label="Group chats"
        >
          {(["recent", "client"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={grouping === value}
              onClick={() => setGrouping(value)}
              className={`outline-box press eyebrow rounded-sm px-3 py-1.5 ${grouping === value ? "bg-ink text-paper" : "bg-paper"}`}
            >
              {value === "recent" ? "Recent" : "By client"}
            </button>
          ))}
        </div>
      </div>

      <nav
        aria-label="Chats"
        className="cm-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {notice ? (
          <p role="alert" className="mx-1 mb-2 text-xs text-seal-red">
            {notice}
          </p>
        ) : null}
        {loading ? (
          <ul className="space-y-1.5 px-1">
            {[0, 1, 2, 3, 4].map((index) => (
              <li key={index} className="cm-shimmer h-7 rounded-sm" />
            ))}
          </ul>
        ) : null}
        {groups.map((group) => {
          const card = group.clientId
            ? cards.find((item) => item.id === group.clientId)
            : undefined;
          return (
            <section
              key={`${group.title}-${group.clientId ?? ""}`}
              className="mb-3"
            >
              <h3 className="eyebrow flex items-center gap-1.5 px-2 pt-1 pb-1 text-[0.65rem] text-stone">
                {grouping === "client" ? (
                  card ? (
                    <Portrait
                      name={card.name}
                      url={card.portraitUrl}
                      size="xs"
                    />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-full bg-ink/80 text-paper">
                      <Icon name="people" className="size-3" />
                    </span>
                  )
                ) : null}
                {group.title}
              </h3>
              <ul>
                {group.threads.map((thread) => (
                  <motion.li
                    key={thread.id}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="group relative"
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(thread)}
                      aria-current={activeId === thread.id}
                      title={thread.preview || thread.title}
                      className={`block w-full truncate rounded-sm border-2 py-1.5 pr-7 pl-2 text-left text-sm ${activeId === thread.id ? "border-ink bg-paper font-medium shadow-hard-sm" : "border-transparent text-ink-muted hover:border-ink/20 hover:bg-paper/70 hover:text-ink"}`}
                    >
                      {grouping === "recent" && thread.clientName ? (
                        <span className="mr-1 text-stone">
                          {thread.clientName.split(" ")[0]} ·
                        </span>
                      ) : null}
                      {thread.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(thread)}
                      aria-label={`Delete ${thread.title}`}
                      className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-1 text-stone opacity-0 group-hover:opacity-100 hover:text-seal-red focus:opacity-100"
                    >
                      <Icon name="trash" className="size-3.5" />
                    </button>
                  </motion.li>
                ))}
              </ul>
            </section>
          );
        })}
        {!loading && threads.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-stone">
            Your chats land here.
          </p>
        ) : null}
      </nav>

      <Link
        href="/demos/client-manager/mcp"
        className="eyebrow flex items-center gap-2 border-ink border-t-2 px-4 py-3 text-ink-muted hover:bg-paper hover:text-federal-blue"
      >
        <Icon name="plug" className="size-4" />
        Use in Claude Code
        <Icon name="chevron" className="ml-auto size-3.5" />
      </Link>
    </div>
  );
}
