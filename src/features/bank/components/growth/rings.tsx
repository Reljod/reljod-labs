"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { formatDate } from "../../domain/dates";
import type { ChangelogEntry } from "../../domain/views";
import { Badge, cx } from "../ui";
import { safeHref } from "./links";

const SIZE = 400;
const CENTRE = SIZE / 2;
const PITH = 16;
const OUTER = 184;
const POINTS = 96;

/** A small stable number from a string, so a ring keeps its shape between renders. */
function seed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/** One ring as a closed path: a circle with a slight, irregular wobble, as wood grows. */
function ringPath(radius: number, wobble: number, id: string): string {
  const a = seed(id);
  const b = seed(`${id}~`);
  const parts: string[] = [];
  for (let point = 0; point <= POINTS; point += 1) {
    const angle = (point / POINTS) * Math.PI * 2;
    const r =
      radius +
      wobble * Math.sin(3 * angle + a * 6.28) +
      wobble * 0.6 * Math.sin(5 * angle + b * 6.28) +
      // The tree leans a little the same way every year.
      wobble * 0.8 * Math.cos(angle - 0.6);
    const x = CENTRE + r * Math.cos(angle);
    const y = CENTRE + r * Math.sin(angle);
    parts.push(`${point === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `${parts.join(" ")} Z`;
}

const stroke = (entry: ChangelogEntry) =>
  entry.mine
    ? "var(--color-federal-blue)"
    : entry.kind === "founding"
      ? "var(--color-stone)"
      : "var(--color-ink)";

/**
 * Growth rings: what the bank learned, as a cross-section of a trunk. The
 * founding capabilities are the quiet inner rings; each thing learned since
 * is a new ring outside them, the newest outermost (it grows in). Rings this
 * Owner asked for are in the accent. Beside it, the Changelog.
 */
export function GrowthRings({ changelog }: { changelog: ChangelogEntry[] }) {
  const reduce = useReducedMotion();
  const [focus, setFocus] = useState<string | null>(null);
  const rings = [...changelog].sort((a, b) => {
    if (a.kind === "founding" && b.kind !== "founding") return -1;
    if (b.kind === "founding" && a.kind !== "founding") return 1;
    return a.learnedAt.localeCompare(b.learnedAt);
  });
  const step = (OUTER - PITH) / Math.max(rings.length, 1);
  const wobble = Math.min(step * 0.22, 3.2);
  const newest = rings.at(-1);
  const learned = rings.filter((ring) => ring.kind !== "founding").length;

  return (
    <div
      className="grid gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start"
      data-testid="bank-growth-rings"
    >
      <figure className="mx-auto w-full max-w-[22rem]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Growth rings: ${rings.length} rings, ${learned} learned since the bank opened`}
        >
          {/* The bark: a heavy ink edge one ring out. */}
          <path
            d={ringPath(OUTER + 9, 3.5, "bark")}
            fill="var(--color-limestone)"
            stroke="var(--color-ink)"
            strokeWidth={4}
          />
          <path
            d={ringPath(OUTER + 2, 2.5, "sapwood")}
            fill="var(--color-paper)"
            stroke="none"
          />
          {/* A check in the wood, from the pith outwards. */}
          <path
            d={`M${CENTRE + 6} ${CENTRE - 4} L${CENTRE + 60} ${CENTRE - 40} L${CENTRE + 74} ${CENTRE - 46} L${CENTRE + 118} ${CENTRE - 84}`}
            fill="none"
            stroke="var(--color-ink)"
            strokeOpacity={0.35}
            strokeWidth={1.5}
          />
          {rings.map((ring, index) => {
            const radius = PITH + step * (index + 1);
            const lit = focus === ring.id;
            const isNewest = ring === newest && ring.kind !== "founding";
            return (
              <motion.path
                key={ring.id}
                d={ringPath(radius, wobble, ring.id)}
                fill="none"
                stroke={lit ? "var(--color-brass)" : stroke(ring)}
                strokeWidth={
                  lit ? 5 : ring.mine ? 3 : ring.kind === "founding" ? 1.5 : 2.2
                }
                style={{
                  transformOrigin: `${CENTRE}px ${CENTRE}px`,
                  transformBox: "view-box",
                }}
                initial={
                  isNewest && !reduce ? { opacity: 0, scale: 0.94 } : false
                }
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 1.1,
                  ease: [0.2, 0.8, 0.2, 1],
                  delay: 0.2,
                }}
              >
                <title>{ring.title}</title>
              </motion.path>
            );
          })}
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={PITH * 0.55}
            fill="var(--color-ink)"
          />
        </svg>
        <figcaption className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.7rem] text-ink-muted">
          <Key colour="bg-stone" label="Founding" />
          <Key colour="bg-ink" label="Learned" />
          <Key colour="bg-federal-blue" label="You asked" />
        </figcaption>
      </figure>

      <div className="min-w-0">
        <h3 className="eyebrow mb-2 text-[0.65rem] font-bold text-ink-muted">
          Changelog: what this bank learned
        </h3>
        <ol
          className="divide-y divide-ink/15 border-ink border-y-2"
          data-testid="bank-growth-changelog"
        >
          {[...rings].reverse().map((ring, index) => (
            <li
              key={ring.id}
              onPointerEnter={() => setFocus(ring.id)}
              onPointerLeave={() => setFocus(null)}
              className={cx(
                "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 py-1.5 text-sm",
                focus === ring.id && "bg-brass/20",
                ring.kind === "founding" && "text-ink-muted",
              )}
            >
              <span className="w-6 shrink-0 font-mono text-[0.65rem] text-ink-muted tabular-nums">
                {rings.length - index}
              </span>
              <span className="min-w-0 flex-1">{ring.title}</span>
              {ring.mine ? <Badge tone="blue">You asked</Badge> : null}
              {ring.kind !== "founding" ? (
                <Badge tone={ring.kind === "bug" ? "amber" : "neutral"}>
                  {ring.kind}
                </Badge>
              ) : null}
              <span className="font-mono text-[0.65rem] text-ink-muted">
                {ring.kind === "founding"
                  ? "at opening"
                  : formatDate(ring.learnedAt.slice(0, 10))}
              </span>
              {safeHref(ring.prUrl) ? (
                <a
                  href={safeHref(ring.prUrl) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[0.65rem] font-bold text-federal-blue underline"
                >
                  PR #{ring.prNumber}
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className={cx("inline-block h-0.5 w-4", colour)}
      />
      {label}
    </span>
  );
}
