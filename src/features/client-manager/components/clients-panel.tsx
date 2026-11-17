"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { BRANCHES, TONE_HEX } from "../domain/categories";
import type { CatalogCard } from "../server/service";
import { Icon } from "./icons";
import { Portrait } from "./portrait";

/**
 * The book: every client as a row with their portrait, persona and a bar of
 * what their graph holds, coloured by Branch. Opening one shows its file.
 */
export function ClientsPanel({
  cards,
  loading,
  activeId,
  onOpen,
  onAsk,
  onAdd,
}: {
  cards: CatalogCard[];
  loading: boolean;
  activeId: string | null;
  onOpen: (clientId: string) => void;
  onAsk: (clientId: string) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((card) =>
      [
        card.name,
        card.persona?.archetype,
        card.persona?.headline,
        ...(card.persona?.traits ?? []),
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [cards, filter]);
  const mine = visible.filter((card) => !card.isSample);
  const samples = visible.filter((card) => card.isSample);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-ink border-b-2 p-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Find a client</span>
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone"
          />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find a client"
            className="outline-box w-full rounded-sm bg-paper py-1.5 pr-2 pl-8 text-sm shadow-hard-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
          />
        </label>
        <button
          type="button"
          onClick={onAdd}
          className="outline-box press eyebrow flex shrink-0 items-center gap-1 rounded-sm bg-federal-blue px-2.5 py-1.5 font-bold text-paper"
        >
          <Icon name="plus" className="size-3.5" />
          Client
        </button>
      </div>
      <div className="cm-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <ul className="space-y-2 p-1">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="cm-shimmer h-14 rounded-sm" />
            ))}
          </ul>
        ) : null}
        {mine.length > 0 ? (
          <Group
            title="Yours"
            cards={mine}
            activeId={activeId}
            onOpen={onOpen}
            onAsk={onAsk}
          />
        ) : null}
        {samples.length > 0 ? (
          <Group
            title="Samples"
            cards={samples}
            activeId={activeId}
            onOpen={onOpen}
            onAsk={onAsk}
          />
        ) : null}
        {!loading && visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-muted">
            No clients match.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Group({
  title,
  cards,
  activeId,
  onOpen,
  onAsk,
}: {
  title: string;
  cards: CatalogCard[];
  activeId: string | null;
  onOpen: (clientId: string) => void;
  onAsk: (clientId: string) => void;
}) {
  return (
    <section className="mb-3">
      <h3 className="eyebrow px-2 pt-1 pb-1.5 text-[0.6rem] text-stone">
        {title} · {cards.length}
      </h3>
      <ul className="space-y-0.5">
        {cards.map((card, index) => {
          const total = Object.values(card.branches).reduce(
            (sum, value) => sum + value,
            0,
          );
          return (
            <motion.li
              key={card.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.3) }}
              className="group relative"
              data-testid="client-card"
            >
              <button
                type="button"
                onClick={() => onOpen(card.id)}
                aria-current={activeId === card.id}
                className={`flex w-full items-center gap-3 rounded-sm border-2 p-2 text-left ${activeId === card.id ? "border-ink bg-paper shadow-hard-sm" : "border-transparent hover:border-ink/20 hover:bg-paper/80"}`}
              >
                <Portrait
                  name={card.name}
                  url={card.portraitUrl}
                  size="sm"
                  building={card.building}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {card.name}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {card.building
                      ? "Building…"
                      : (card.persona?.archetype ?? "No persona yet")}
                  </span>
                  <span
                    className="mt-1.5 flex h-1.5 overflow-hidden border border-ink/30 bg-limestone/50"
                    title={`${total} facts`}
                  >
                    {BRANCHES.map((branch) => {
                      const count = card.branches[branch.id] ?? 0;
                      return count > 0 ? (
                        <span
                          key={branch.id}
                          style={{
                            width: `${(count / Math.max(1, total)) * 100}%`,
                            background: TONE_HEX[branch.tone],
                          }}
                        />
                      ) : null;
                    })}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onAsk(card.id)}
                aria-label={`Ask about ${card.name}`}
                title={`Ask about ${card.name}`}
                className="outline-box absolute top-2 right-2 grid size-7 place-items-center rounded-sm bg-paper text-ink-muted opacity-0 shadow-hard-sm group-hover:opacity-100 hover:bg-morning-haze hover:text-federal-blue focus:opacity-100"
              >
                <Icon name="chat" className="size-3.5" />
              </button>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
