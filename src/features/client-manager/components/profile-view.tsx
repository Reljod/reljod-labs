"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";
import { BRANCHES, toneOf } from "../domain/categories";
import { ROOT_KEY } from "../domain/graph";
import type { ClientSummary, NodeLite } from "../server/service";
import { fetchEdges, keys } from "./api";
import { CertaintyDot } from "./certainty";
import { Icon, type IconName } from "./icons";
import { initialsOf } from "./portrait";

/**
 * The client as a relationship manager reads a client file, a little at a
 * time: four numbers that matter first, then short sections (people, balance
 * sheet, goals, what to watch, what's next) that each show their top few
 * facts and open up on request. Every fact shows how sure it is; clicking one
 * opens it with its sources.
 */

const VALUE_KEYS =
  /^(value|balance|amount|market_value|estimated_value|current_value|net_worth|worth|aum|assets|size|price|premium|cover|coverage|limit|principal|outstanding|stake|ownership|salary|income|target|target_amount|rate)$/i;
const DATE_KEYS = /(^date$|_date$|^when$|^year$|^due|^on$|^since$|^until$)/i;
const PREVIEW = 4;

function valueFrom(node: NodeLite): string | null {
  const entries = Object.entries(node.attributes);
  const hit =
    entries.find(([name]) => VALUE_KEYS.test(name)) ??
    entries.find(([name]) => /value|amount|balance|worth/i.test(name));
  return hit ? String(hit[1]) : null;
}

function dateOf(node: NodeLite): string | null {
  const hit = Object.entries(node.attributes).find(([name]) =>
    DATE_KEYS.test(name),
  );
  return hit ? String(hit[1]) : null;
}

const sortableDate = (value: string | null) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  const year = value.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ? Date.parse(`${year}-07-01`) : Number.POSITIVE_INFINITY;
};

const OWN = ["wealth.accounts", "wealth.holdings", "wealth.property"];

export function ProfileView({
  client,
  onFact,
  onResearch,
}: {
  client: ClientSummary;
  onFact: (key: string) => void;
  onResearch: (topic: string) => void;
}) {
  // The client's own relations name each person: "married to", "accountant".
  const rootEdges = useQuery({
    queryKey: keys.edges(client.id, "root"),
    queryFn: () => fetchEdges(client.id, "root"),
    staleTime: 60_000,
  });
  const relationOf = useMemo(() => {
    // Only relations read from the person to the client describe the person
    // ("advises"); "client is the mother of X" says nothing about X in X's words.
    const map = new Map<string, string>();
    for (const edge of rootEdges.data ?? []) {
      if (edge.to === ROOT_KEY) map.set(edge.from, edge.label);
    }
    return map;
  }, [rootEdges.data]);

  const byLeaf = useMemo(() => {
    const map = new Map<string, NodeLite[]>();
    for (const node of client.nodes) {
      if (node.key === ROOT_KEY) continue;
      const list =
        map.get(node.category) ?? map.set(node.category, []).get(node.category);
      list?.push(node);
    }
    for (const list of map.values())
      list.sort((a, b) => b.confidence - a.confidence);
    return map;
  }, [client.nodes]);
  const leaf = (id: string) => byLeaf.get(id) ?? [];
  const branch = (id: string) =>
    [...byLeaf.entries()]
      .filter(([category]) => category.startsWith(`${id}.`))
      .flatMap(([, list]) => list);

  if (client.nodes.length <= 1) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-ink-muted">
        <span className="cm-pulse size-3 rounded-full bg-brass" />
        <p>Reading everything you shared…</p>
      </div>
    );
  }

  const people = [
    ...leaf("network.family"),
    ...leaf("network.advisors"),
    ...leaf("network.social"),
  ];
  const owns = OWN.flatMap(leaf);
  const owes = leaf("wealth.liabilities");
  const timeline = [...leaf("timeline.past"), ...leaf("timeline.upcoming")]
    .map((node) => ({ node, date: dateOf(node) }))
    .sort((a, b) => sortableDate(a.date) - sortableDate(b.date));
  const upcoming = timeline.filter(
    ({ node }) => node.category === "timeline.upcoming",
  );
  // Upcoming first: that is what a call needs.
  const events = [
    ...upcoming,
    ...timeline.filter((item) => !upcoming.includes(item)).reverse(),
  ];
  const gaps = BRANCHES.flatMap((item) =>
    item.leaves
      .filter((child) => leaf(`${item.id}.${child.id}`).length === 0)
      .map((child) => ({ id: `${item.id}.${child.id}`, label: child.label })),
  );

  const tiles = [
    {
      label: "Owns",
      value: String(owns.length),
      detail: owns[0] ? (valueFrom(owns[0]) ?? owns[0].label) : undefined,
      tone: toneOf("wealth.accounts"),
      target: owns[0]?.key,
    },
    {
      label: "Owes",
      value: String(owes.length),
      detail: owes[0] ? (valueFrom(owes[0]) ?? owes[0].label) : undefined,
      tone: "#b23a2b",
      target: owes[0]?.key,
    },
    {
      label: "People",
      value: String(people.length),
      detail: people[0]?.label,
      tone: toneOf("network.family"),
      target: people[0]?.key,
    },
    {
      label: "Next",
      value: upcoming[0]?.date ?? "·",
      detail: upcoming[0]?.node.label ?? "Nothing scheduled",
      tone: toneOf("goals.objectives"),
      target: upcoming[0]?.node.key,
    },
  ];

  return (
    <div className="cm-scroll @container h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {tiles.map((tile, index) => (
            <motion.li
              key={tile.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <button
                type="button"
                disabled={!tile.target}
                onClick={() => tile.target && onFact(tile.target)}
                className="h-full w-full rounded-sm border border-ink/10 bg-paper p-3 text-left transition-colors hover:border-federal-blue disabled:hover:border-ink/10"
                style={{ boxShadow: `inset 0 3px 0 ${tile.tone}` }}
              >
                <span className="eyebrow text-[0.6rem] text-ink-muted">
                  {tile.label}
                </span>
                <span className="mt-1 block font-mono text-2xl font-bold tabular-nums">
                  {tile.value}
                </span>
                {tile.detail ? (
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {tile.detail}
                  </span>
                ) : null}
              </button>
            </motion.li>
          ))}
        </ul>

        <div className="grid items-start gap-5 @4xl:grid-cols-2">
          <div className="space-y-5">
            {people.length > 0 ? (
              <Section
                title="People"
                icon="people"
                tone={toneOf("network.family")}
                items={people}
              >
                {(shown) => (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                    {shown.map((node) => (
                      <motion.li
                        key={node.key}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                      >
                        <button
                          type="button"
                          onClick={() => onFact(node.key)}
                          className="flex h-full w-full items-start gap-2.5 rounded-sm border border-ink/10 bg-paper p-2.5 text-left hover:border-federal-blue"
                        >
                          <span
                            className="flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[0.65rem] font-bold text-paper"
                            style={{ background: toneOf(node.category) }}
                          >
                            {initialsOf(node.label)}
                          </span>
                          <span className="min-w-0 flex-1 break-words">
                            <span className="block text-sm leading-snug font-semibold">
                              {node.label}
                            </span>
                            <span className="block text-xs leading-snug text-ink-muted">
                              {node.attributes.relation ??
                                node.attributes.role ??
                                relationOf.get(node.key) ??
                                node.category.split(".")[1]}
                            </span>
                          </span>
                          <CertaintyDot
                            confidence={node.confidence}
                            className="mt-1 size-2.5"
                          />
                        </button>
                      </motion.li>
                    ))}
                  </ul>
                )}
              </Section>
            ) : null}

            <BalanceSheet nodes={byLeaf} onFact={onFact} />

            <FactList
              title="Goals"
              icon="spark"
              category="goals"
              nodes={branch("goals")}
              onFact={onFact}
            />
          </div>

          <div className="space-y-5">
            {branch("risk").length > 0 ? (
              <Section
                title="Watch"
                icon="spark"
                tone="#b23a2b"
                items={branch("risk")}
              >
                {(shown) => (
                  <ul className="space-y-0.5">
                    {shown.map((node) => (
                      <Row
                        key={node.key}
                        node={node}
                        onFact={onFact}
                        accent="#b23a2b"
                      />
                    ))}
                  </ul>
                )}
              </Section>
            ) : null}

            {events.length > 0 ? (
              <Section
                title="Timeline"
                icon="walk"
                tone={toneOf("timeline.past")}
                items={events}
              >
                {(shown) => (
                  <ol className="space-y-2.5 border-ink/15 border-l-2 pl-4">
                    {shown.map(({ node, date }) => {
                      const next = node.category === "timeline.upcoming";
                      return (
                        <li key={node.key} className="relative">
                          <span
                            aria-hidden="true"
                            className={`absolute top-1.5 -left-[1.4rem] size-3 rounded-full border-2 ${next ? "border-brass bg-paper" : "border-ink bg-ink"}`}
                          />
                          <button
                            type="button"
                            onClick={() => onFact(node.key)}
                            className="group block w-full text-left"
                          >
                            {date ? (
                              <span
                                className={`block font-mono text-xs font-bold ${next ? "text-brass" : "text-ink-muted"}`}
                              >
                                {date}
                              </span>
                            ) : null}
                            <span className="block text-sm leading-snug group-hover:text-federal-blue">
                              {node.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            ) : null}

            <FactList
              title="Career"
              icon="branch"
              category="career"
              nodes={branch("career")}
              onFact={onFact}
            />
            <FactList
              title="About"
              icon="profile"
              category="profile"
              nodes={[...branch("profile"), ...branch("persona")]}
              onFact={onFact}
            />

            {gaps.length > 0 && client.canAdd ? (
              <details className="group text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-ink-muted hover:text-federal-blue">
                  <Icon name="globe" className="size-3.5" />
                  {gaps.length} gaps to research
                  <Icon
                    name="chevron"
                    className="size-3 transition-transform group-open:rotate-90"
                  />
                </summary>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {gaps.map((gap) => (
                    <li key={gap.id}>
                      <button
                        type="button"
                        onClick={() => onResearch(gap.label)}
                        className="rounded-full border border-dashed border-stone px-2.5 py-1 text-xs text-ink-muted hover:border-federal-blue hover:text-federal-blue"
                      >
                        {gap.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A card that shows its first few items and opens up on request. */
function Section<T>({
  title,
  icon,
  tone,
  items,
  children,
}: {
  title: string;
  icon: IconName;
  tone: string;
  items: T[];
  children: (shown: T[]) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, PREVIEW);
  const hidden = items.length - PREVIEW;
  return (
    <section
      aria-label={title}
      className="rounded-sm border border-ink/10 bg-paper/70 p-4"
    >
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span
          className="flex size-5 items-center justify-center rounded-sm text-paper"
          style={{ background: tone }}
        >
          <Icon name={icon} className="size-3" strokeWidth={2.4} />
        </span>
        {title}
        <span className="font-normal text-stone">{items.length}</span>
      </h3>
      {children(shown)}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-federal-blue"
        >
          <Icon
            name="chevron"
            className={`size-3 transition-transform ${all ? "-rotate-90" : "rotate-90"}`}
          />
          {all ? "Less" : `${hidden} more`}
        </button>
      ) : null}
    </section>
  );
}

function Row({
  node,
  onFact,
  secondary,
  value,
  accent,
}: {
  node: NodeLite;
  onFact: (key: string) => void;
  secondary?: string | null;
  value?: string | null;
  accent?: string;
}) {
  return (
    <motion.li initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
      <button
        type="button"
        onClick={() => onFact(node.key)}
        className="group flex w-full items-start gap-2.5 rounded-sm px-1.5 py-1.5 text-left hover:bg-morning-haze/50"
        style={accent ? { boxShadow: `inset 2px 0 0 ${accent}` } : undefined}
      >
        <CertaintyDot confidence={node.confidence} className="mt-1 size-2.5" />
        <span className="min-w-0 flex-1 break-words">
          <span className="block text-sm leading-snug group-hover:text-federal-blue">
            {node.label}
          </span>
          {secondary ? (
            <span className="block text-xs leading-snug text-ink-muted">
              {secondary}
            </span>
          ) : null}
        </span>
        {value ? (
          <span className="shrink-0 pl-2 text-right font-mono text-sm font-semibold tabular-nums">
            {value}
          </span>
        ) : null}
      </button>
    </motion.li>
  );
}

function FactList({
  title,
  icon,
  category,
  nodes,
  onFact,
}: {
  title: string;
  icon: IconName;
  category: string;
  nodes: NodeLite[];
  onFact: (key: string) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <Section
      title={title}
      icon={icon}
      tone={toneOf(`${category}.x`)}
      items={nodes}
    >
      {(shown) => (
        <ul className="space-y-0.5">
          {shown.map((node) => {
            const value = valueFrom(node) ?? dateOf(node);
            const role = node.attributes.role ?? null;
            return (
              <Row
                key={node.key}
                node={node}
                onFact={onFact}
                secondary={role && role !== value ? role : null}
                value={value && value !== node.label ? value : null}
              />
            );
          })}
        </ul>
      )}
    </Section>
  );
}

const SHEET: { id: string; label: string; owe?: boolean }[] = [
  { id: "wealth.accounts", label: "Accounts" },
  { id: "wealth.holdings", label: "Holdings" },
  { id: "wealth.property", label: "Property" },
  { id: "career.income", label: "Income" },
  { id: "wealth.liabilities", label: "Liabilities", owe: true },
  { id: "wealth.insurance", label: "Insurance" },
];

/** Wealth as a balance sheet: what they own, what they owe, what covers them. */
function BalanceSheet({
  nodes,
  onFact,
}: {
  nodes: Map<string, NodeLite[]>;
  onFact: (key: string) => void;
}) {
  const rows = SHEET.flatMap((group) =>
    (nodes.get(group.id) ?? []).map((node) => ({ node, group })),
  );
  if (rows.length === 0) return null;
  return (
    <Section
      title="Balance sheet"
      icon="branch"
      tone={toneOf("wealth.accounts")}
      items={rows}
    >
      {(shown) => (
        <ul>
          {shown.map(({ node, group }, index) => {
            const value = valueFrom(node);
            const first = shown[index - 1]?.group.id !== group.id;
            return (
              <li key={node.key}>
                {first ? (
                  <p className="eyebrow pt-2 pb-0.5 text-[0.6rem] text-stone">
                    {group.label}
                  </p>
                ) : null}
                <ul>
                  <Row
                    node={node}
                    onFact={onFact}
                    secondary={
                      node.attributes.institution ??
                      node.attributes.provider ??
                      null
                    }
                    value={
                      value
                        ? group.owe
                          ? `−${value.replace(/^-/, "")}`
                          : value
                        : null
                    }
                    accent={group.owe ? "#b23a2b" : undefined}
                  />
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
