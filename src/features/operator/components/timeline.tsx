"use client";

import { memo, useEffect, useRef } from "react";
import { duration } from "./format";
import type { ActionChip, TimelineItem } from "./run-view";
import { cx, Panel, Spinner, Tag } from "./ui";

const JUMP =
  "rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue";

function Chip({
  chip,
  current,
  onJump,
}: {
  chip: ActionChip;
  current: boolean;
  onJump: (frame: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(chip.n)}
      aria-current={current ? "step" : undefined}
      title={
        chip.message
          ? `Frame ${chip.n} on ${chip.screen}. HARBOURMASTER said: ${chip.message}`
          : `Frame ${chip.n} on ${chip.screen}`
      }
      className={cx(
        JUMP,
        "inline-flex max-w-full items-center gap-1 border px-1.5 py-px font-mono text-[0.68rem]",
        current
          ? "border-ink bg-ink text-paper"
          : "border-ink/25 bg-paper hover:border-ink hover:bg-morning-haze",
      )}
    >
      <span className="truncate">{chip.label}</span>
      {chip.changes > 0 ? (
        <span
          className={cx("font-bold", current ? "text-brass" : "text-ivy")}
          title="Records committed"
        >
          +{chip.changes}
        </span>
      ) : null}
    </button>
  );
}

const DECISION = {
  approved: { tone: "green", text: "Approved by a person" },
  refused: { tone: "red", text: "Refused by a person" },
  expired: { tone: "brass", text: "Nobody decided in time: refused" },
} as const;

function Body({
  item,
  shown,
  onJump,
}: {
  item: TimelineItem;
  shown: number | null;
  onJump: (frame: number) => void;
}) {
  const jump = () => {
    if (item.frame !== null) onJump(item.frame);
  };
  switch (item.kind) {
    case "turn":
      return (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={jump}
            className={cx(JUMP, "text-sm leading-snug hover:underline")}
          >
            <span className="mr-1.5 font-mono text-[0.65rem] font-bold text-ink-muted">
              {item.turn === 0 && !item.intent ? "START" : `TURN ${item.turn}`}
            </span>
            {item.intent || (item.turn === 0 ? "HARBOURMASTER is up." : "…")}
          </button>
          {item.chips.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {item.chips.map((chip) => (
                <Chip
                  key={chip.n}
                  chip={chip}
                  current={chip.n === shown}
                  onJump={onJump}
                />
              ))}
            </div>
          ) : null}
        </div>
      );
    case "rule":
      return (
        <button
          type="button"
          onClick={jump}
          className={cx(
            JUMP,
            "flex w-full flex-col gap-1 border-2 border-seal-red bg-seal-red/10 px-2 py-1.5",
          )}
        >
          <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-seal-red">
            <span className="font-mono uppercase">
              Rule {item.outcome === "paused" ? "paused the Run" : "refused"}
            </span>
            <Tag tone="red">{item.ruleId}</Tag>
          </span>
          <span className="text-xs">{item.reason}</span>
          <span className="font-mono text-[0.68rem] text-ink-muted">
            {item.label} on {item.screen}
          </span>
        </button>
      );
    case "pause":
      return (
        <button
          type="button"
          onClick={jump}
          className={cx(
            JUMP,
            "flex w-full flex-col gap-1 border-2 border-ink bg-brass/25 px-2 py-1.5",
          )}
        >
          <span className="font-mono text-xs font-bold uppercase">
            Paused for a person
          </span>
          <span className="text-xs">{item.pending.label}</span>
          <span>
            {item.decision ? (
              <Tag tone={DECISION[item.decision].tone}>
                {DECISION[item.decision].text}
              </Tag>
            ) : (
              <Tag tone="brass">
                <Spinner className="size-2.5" />
                Waiting
              </Tag>
            )}
          </span>
          {item.note ? (
            <span className="text-xs text-ink-muted">{item.note}</span>
          ) : null}
        </button>
      );
    case "skill":
      return (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <Tag tone="blue">Skill</Tag>
          <span className="font-semibold">{item.title}</span>
        </p>
      );
    case "code":
      return (
        <details className="text-xs">
          <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 rounded-sm focus-visible:outline-2 focus-visible:outline-federal-blue">
            <Tag tone="neutral">Code</Tag>
            {item.exitCode < 0 ? (
              <Tag tone="blue">
                <Spinner className="size-2.5" />
                running
              </Tag>
            ) : (
              <Tag tone={item.exitCode === 0 ? "green" : "red"}>
                exit {item.exitCode}
              </Tag>
            )}
            {item.exitCode >= 0 ? (
              <span className="font-mono text-ink-muted">
                {duration(item.ms)}
              </span>
            ) : null}
          </summary>
          <pre className="op-scroll mt-1.5 max-h-56 overflow-auto rounded-sm bg-ink p-2 font-mono text-[0.68rem] leading-relaxed text-paper">
            {item.code}
          </pre>
          {item.stdout ? (
            <pre className="op-scroll mt-1 max-h-40 overflow-auto rounded-sm border border-ink/15 bg-marble p-2 font-mono text-[0.68rem] whitespace-pre-wrap">
              {item.stdout}
            </pre>
          ) : null}
          {item.stderr ? (
            <pre className="op-scroll mt-1 max-h-32 overflow-auto rounded-sm border border-seal-red/30 bg-seal-red/5 p-2 font-mono text-[0.68rem] whitespace-pre-wrap text-seal-red">
              {item.stderr}
            </pre>
          ) : null}
        </details>
      );
    case "log":
      return (
        <p
          className={cx(
            "font-mono text-[0.7rem]",
            item.level === "error" && "text-seal-red",
            item.level === "warn" && "text-oak",
            item.level === "info" && "text-ink-muted",
          )}
        >
          {item.text}
        </p>
      );
  }
}

/**
 * One timeline item. Memoised: a finished item keeps its identity in the
 * fold, so only the live one (and the two whose highlight moves) re-render.
 */
const Row = memo(function Row({
  item,
  shown,
  onJump,
}: {
  item: TimelineItem;
  /** The Frame on screen, when it is one of this item's; else null. */
  shown: number | null;
  onJump: (frame: number) => void;
}) {
  return (
    <li
      data-item={item.id}
      className={cx(
        "border-l-4 py-2 pr-3 pl-3",
        shown !== null
          ? "border-federal-blue bg-morning-haze/50"
          : "border-transparent",
      )}
    >
      <Body item={item} shown={shown} onJump={onJump} />
    </li>
  );
});

/** The Trail as a list: a Turn's intent, its Actions, and what the harness did in between. */
export function Timeline({
  items,
  activeId,
  shown,
  going,
  onJump,
}: {
  items: TimelineItem[];
  /** The item the Frame on screen belongs to. */
  activeId: string | null;
  /** The Frame on screen. */
  shown: number | null;
  going: boolean;
  /** Stable across renders. */
  onJump: (frame: number) => void;
}) {
  const box = useRef<HTMLOListElement>(null);

  // Keeps the item on screen in view, moving this list only, never the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shown` moves inside a Turn, which may then need scrolling too
  useEffect(() => {
    const list = box.current;
    if (!list || !activeId) return;
    const row = list.querySelector<HTMLElement>(
      `[data-item="${CSS.escape(activeId)}"]`,
    );
    if (!row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [activeId, shown]);

  return (
    <Panel
      eyebrow="Trail"
      title="What it did, Turn by Turn"
      bodyClassName=""
      actions={going ? <Spinner /> : null}
    >
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">
          {going ? "Waiting for the first Turn…" : "Nothing in the Trail."}
        </p>
      ) : (
        <ol
          ref={box}
          className="op-scroll relative max-h-72 divide-y divide-ink/10 overflow-y-auto xl:max-h-[38rem]"
        >
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              shown={item.id === activeId ? shown : null}
              onJump={onJump}
            />
          ))}
        </ol>
      )}
    </Panel>
  );
}
