"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BRANCHES, TONE_HEX } from "../domain/categories";
import type { CatalogCard } from "../server/service";
import { IntakeDialog } from "./intake-dialog";
import { Portrait } from "./portrait";
import "./client-manager.css";

async function fetchCatalog(): Promise<CatalogCard[]> {
  const response = await fetch("/api/client-manager/clients", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load the Catalog");
  return ((await response.json()) as { clients: CatalogCard[] }).clients;
}

export function Catalog() {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const query = useQuery({
    queryKey: ["client-manager", "catalog"],
    queryFn: fetchCatalog,
    // Cards that are still building refresh until their portrait and persona land.
    refetchInterval: (current) =>
      current.state.data?.some(
        (card) => card.building || card.status === "building",
      )
        ? 4000
        : false,
  });
  const cards = query.data ?? [];
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
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <label htmlFor="cm-filter" className="sr-only">
            Find a client
          </label>
          <input
            id="cm-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find a client, a trait, a type…"
            className="outline-box w-full rounded-sm bg-paper px-3 py-2.5 text-sm focus:outline-2 focus:outline-federal-blue"
          />
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="outline-box press inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-federal-blue px-5 py-2 font-mono text-sm font-bold tracking-[0.1em] text-paper uppercase"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            +
          </span>{" "}
          Add client
        </button>
      </div>

      {query.isLoading ? (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <li
              key={index}
              className="outline-box cm-shimmer h-80 rounded-sm"
            />
          ))}
        </ul>
      ) : null}

      {query.isError ? (
        <p className="outline-box mt-8 rounded-sm bg-paper p-4 text-seal-red">
          The Catalog didn't load. Refresh to try again.
        </p>
      ) : null}

      {mine.length > 0 ? (
        <section aria-labelledby="cm-mine" className="mt-10">
          <h2 id="cm-mine" className="eyebrow font-bold">
            Your clients · {mine.length}
          </h2>
          <CardGrid cards={mine} />
        </section>
      ) : null}

      {query.isSuccess && cards.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} />
      ) : null}

      {samples.length > 0 ? (
        <section aria-labelledby="cm-samples" className="mt-10">
          <h2 id="cm-samples" className="eyebrow font-bold">
            Sample book · {samples.length}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Fictional clients, built by the same pipeline. Open one and ask it
            anything.
          </p>
          <CardGrid cards={samples} />
        </section>
      ) : null}

      <AnimatePresence>
        {adding ? <IntakeDialog onClose={() => setAdding(false)} /> : null}
      </AnimatePresence>
    </>
  );
}

function CardGrid({ cards }: { cards: CatalogCard[] }) {
  return (
    <ul className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence initial>
        {cards.map((card, index) => (
          <motion.li
            key={card.id}
            layout
            initial={{ opacity: 0, y: 24, rotate: index % 2 ? 1.5 : -1.5 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{
              type: "spring",
              stiffness: 220,
              damping: 22,
              delay: Math.min(index * 0.06, 0.6),
            }}
          >
            <ClientCard card={card} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function ClientCard({ card }: { card: CatalogCard }) {
  const building = card.building || card.status === "building";
  return (
    <Link
      href={`/demos/client-manager/${card.id}`}
      data-testid="client-card"
      className="group outline-box press relative flex h-full flex-col overflow-hidden rounded-sm bg-paper"
      aria-label={`Open ${card.name}'s graph`}
    >
      <div className="relative h-44 overflow-hidden border-ink border-b-2 bg-limestone">
        <Constellation branches={card.branches} />
        <div className="absolute inset-0 flex items-end justify-center pb-3">
          <div className="transition-transform duration-500 group-hover:scale-105">
            <Portrait
              name={card.name}
              url={card.portraitUrl}
              size="lg"
              building={building}
              className="size-28! text-4xl!"
            />
          </div>
        </div>
        {card.isSample ? (
          <span className="eyebrow outline-box absolute top-3 left-3 rounded-sm bg-brass px-1.5 py-0.5 font-bold">
            Sample
          </span>
        ) : null}
        {building ? (
          <span className="eyebrow outline-box absolute top-3 right-3 flex items-center gap-1.5 rounded-sm bg-ink px-1.5 py-0.5 font-bold text-paper">
            <span className="size-1.5 rounded-full bg-brass motion-safe:animate-live-pulse" />{" "}
            Building
          </span>
        ) : card.status === "failed" ? (
          <span className="eyebrow outline-box absolute top-3 right-3 rounded-sm bg-seal-red px-1.5 py-0.5 font-bold text-paper">
            Failed
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="eyebrow text-federal-blue">
          {card.persona?.archetype ??
            (building ? "Reading the Intake…" : "No persona yet")}
        </p>
        <h3 className="mt-1 font-mono text-xl leading-tight font-bold uppercase [overflow-wrap:anywhere]">
          {card.name}
        </h3>
        {card.persona?.headline ? (
          <p className="mt-2 line-clamp-2 text-sm text-ink-muted">
            {card.persona.headline}
          </p>
        ) : building ? (
          <div className="mt-3 space-y-2">
            <div className="cm-shimmer h-3 w-full rounded-sm" />
            <div className="cm-shimmer h-3 w-2/3 rounded-sm" />
          </div>
        ) : null}
        {card.persona?.traits?.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {card.persona.traits.slice(0, 4).map((trait) => (
              <li
                key={trait}
                className="eyebrow rounded-sm border border-ink/30 bg-marble px-1.5 py-0.5 text-[0.6rem]"
              >
                {trait}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-center justify-between pt-4 font-mono text-xs">
          <span>
            <strong className="text-base tabular-nums">{card.nodes}</strong>{" "}
            nodes ·{" "}
            <strong className="text-base tabular-nums">{card.edges}</strong>{" "}
            edges
          </span>
          <span
            aria-hidden="true"
            className="font-bold text-federal-blue transition-transform group-hover:translate-x-1"
          >
            Open →
          </span>
        </div>
      </div>
    </Link>
  );
}

/** A card's miniature graph: one spoke per Branch, one dot per Node it holds. */
function Constellation({ branches }: { branches: Record<string, number> }) {
  return (
    <svg
      viewBox="-160 -100 320 200"
      className="absolute inset-0 h-full w-full opacity-80 transition-transform duration-700 group-hover:scale-110 group-hover:rotate-6"
      aria-hidden="true"
    >
      <circle
        r={70}
        fill="none"
        stroke="#14213d"
        strokeOpacity={0.15}
        strokeDasharray="2 5"
      />
      {BRANCHES.map((branch, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / BRANCHES.length;
        const count = branches[branch.id] ?? 0;
        const tone = TONE_HEX[branch.tone];
        const hx = Math.cos(angle) * 70;
        const hy = Math.sin(angle) * 70;
        return (
          <g key={branch.id}>
            <line
              x1={0}
              y1={0}
              x2={hx}
              y2={hy}
              stroke={tone}
              strokeOpacity={count ? 0.55 : 0.15}
              strokeWidth={1.5}
            />
            <circle
              cx={hx}
              cy={hy}
              r={count ? 6 + Math.min(count, 12) * 0.5 : 4}
              fill={tone}
              fillOpacity={count ? 0.85 : 0.2}
              stroke="#14213d"
              strokeWidth={1}
            />
            {Array.from({ length: Math.min(count, 14) }, (_, dot) => {
              const spread = angle + (dot - Math.min(count, 14) / 2) * 0.09;
              const radius = 92 + (dot % 3) * 9;
              return (
                <circle
                  key={`${branch.id}-${dot}`}
                  cx={Math.cos(spread) * radius}
                  cy={Math.sin(spread) * radius}
                  r={2.4}
                  fill={tone}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="outline-box mt-10 flex flex-col items-center gap-4 rounded-sm bg-paper p-10 text-center">
      <p className="font-mono text-2xl font-bold uppercase">No clients yet</p>
      <p className="max-w-md text-ink-muted">
        Add one: a name, whatever you know about them, and any files. The
        pipeline turns it into a graph you can talk to.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="outline-box press rounded-sm bg-federal-blue px-5 py-2 font-mono text-sm font-bold text-paper uppercase"
      >
        Add your first client
      </button>
    </div>
  );
}
