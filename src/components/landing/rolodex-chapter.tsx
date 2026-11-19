"use client";

import { motion, useMotionValueEvent, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Chapter,
  chapterScrollTop,
  useChapterProgress,
} from "@/components/motion/chapter";
import { at, drumPosition } from "@/components/motion/drum";
import { useReduced } from "@/components/motion/use-reduced";
import { BrowserFrame } from "@/components/showcase/browser-frame";
import { Icon, IconTile } from "@/components/ui/icon";
import { LiveBadge } from "@/components/ui/live-badge";
import { demoProblems, sceneNumber } from "@/content/landing";
import { demoCount, liveDemos } from "@/content/projects";
import { demoPreviews } from "./demo-previews";
import "./landing.css";

const COUNT = liveDemos.length;
/** "Twelve problems", counted from the live demos. */
const TITLE = `${demoCount.Word} problems`;
/** The drum turns over this part of the chapter. */
const TURN = [0.06, 0.92] as const;

const number = (index: number) => String(index + 1).padStart(2, "0");

/**
 * The cards worth drawing around the front one (the one just flipped, and up
 * to three waiting), back to front; the card sliding out paints over all.
 */
function near(active: number) {
  return liveDemos
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => index >= active - 1 && index <= active + 3)
    .reverse();
}

/** The live demos on a Rolodex that turns as you scroll. */
export function RolodexChapter() {
  return (
    <Chapter
      id="demos"
      label={`${TITLE} I've built for`}
      length={4.5}
      overlap
      className="bg-limestone"
      stageClassName="bg-limestone"
    >
      <Drum />
    </Chapter>
  );
}

function Drum() {
  const progress = useChapterProgress();
  const reduce = useReduced();
  const position = useTransform(progress, (p) => drumPosition(p, COUNT, TURN));
  const [active, setActive] = useState(0);
  useMotionValueEvent(position, "change", (value) =>
    setActive(Math.round(value)),
  );
  // Start on the card the drum is really showing (the last one when the
  // chapter is shown finished), not on card 01.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read once the setting arrives.
  useEffect(() => setActive(Math.round(position.get())), [reduce]);

  // Each number on the rail scrolls the page to that card.
  function jump(index: number) {
    const section = document.getElementById("demos");
    if (!section) return;
    const p = TURN[0] + (index / (COUNT - 1)) * (TURN[1] - TURN[0]);
    window.scrollTo({
      top: chapterScrollTop(section, p),
      behavior: reduce ? "auto" : "smooth",
    });
  }

  const demo = liveDemos[active];

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:grid lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-10 lg:py-10">
      <div>
        <p className="eyebrow mb-2 text-ink-muted lg:mb-4">
          {sceneNumber("demos")} · The projects
        </p>
        <h2 className="font-mono text-[clamp(1.35rem,min(5vw,5svh),2.25rem)] leading-[1.1] font-bold uppercase">
          {TITLE} I&apos;ve built for.
        </h2>

        <div className="relative mt-3 min-h-[3.25rem] sm:min-h-[4.5rem] lg:mt-8 lg:min-h-[9rem]">
          {liveDemos.map((item, index) =>
            Math.abs(index - active) > 1 ? null : (
              <motion.p
                key={item.slug}
                aria-hidden={index !== active}
                className="problem absolute inset-x-0 top-0 text-[clamp(0.95rem,min(3.4vw,2.9svh),1.65rem)] leading-snug lg:leading-[1.25]"
                style={at(position, index)}
              >
                “{demoProblems[item.slug]}”
              </motion.p>
            ),
          )}
        </div>

        <nav
          aria-label="Projects"
          className="mt-2 flex flex-wrap items-center gap-1.5 lg:mt-6 lg:gap-2"
        >
          {liveDemos.map((item, index) => (
            <button
              key={item.slug}
              type="button"
              onClick={() => jump(index)}
              aria-label={`Project ${number(index)}: ${item.title}`}
              aria-current={index === active ? "true" : undefined}
              className={`outline-box press flex size-9 items-center justify-center rounded-sm font-mono text-xs font-bold lg:size-10 lg:text-sm ${index === active ? "bg-ink text-paper" : "bg-paper"}`}
            >
              {number(index)}
            </button>
          ))}
        </nav>
        <Link
          href={demo.href ?? "/demos"}
          className="eyebrow mt-6 hidden items-center gap-2 font-bold text-federal-blue hover:underline lg:inline-flex"
        >
          Open {demo.title}
          <Icon name="arrow" size={16} />
        </Link>
      </div>

      <div className="drum relative min-h-0 flex-1 lg:h-[min(38rem,100%)] lg:flex-none">
        {/* Front card painted last; only the cards near the front are drawn. */}
        {near(active).map(({ item, index }) => (
          <motion.article
            key={item.slug}
            aria-hidden={index !== active}
            className={`drum-card absolute top-1/2 left-1/2 w-[min(76vw,19rem,max(13rem,(100svh-23rem)*1.1))] sm:w-[min(80vw,28rem,max(13rem,(100svh-21rem)*1.1))] lg:w-[min(100%,31rem,max(16rem,(100svh-12rem)*1.05))] ${index === active ? "" : "pointer-events-none"}`}
            style={at(position, index)}
          >
            <span
              className="absolute -top-[1.85rem] flex h-[1.85rem] items-center gap-2 border-2 border-ink border-b-0 bg-paper px-3 font-mono text-xs font-bold"
              style={{ left: `${6 + index * 11}%` }}
            >
              {number(index)}
            </span>
            <div className="outline-box relative overflow-hidden bg-paper shadow-hard-lg">
              <div className="flex items-center justify-between gap-3 border-ink border-b-2 px-4 py-2.5">
                <h3 className="truncate font-mono text-sm font-bold uppercase sm:text-base">
                  {item.title}
                </h3>
                <LiveBadge />
              </div>
              <Link
                href={item.href ?? "/demos"}
                tabIndex={index === active ? 0 : -1}
                aria-label={`Open the ${item.title} demo`}
                className="group block bg-limestone p-3 sm:p-4"
              >
                <BrowserFrame address={item.href ?? ""}>
                  {index === active ? (
                    demoPreviews[item.slug]?.(item)
                  ) : (
                    <div className="flex aspect-[960/726] items-center justify-center bg-marble">
                      <IconTile name={item.icon} />
                    </div>
                  )}
                </BrowserFrame>
              </Link>
              <p className="hidden px-4 pt-3 text-sm text-ink-muted sm:line-clamp-2">
                {item.summary}
              </p>
              <p className="eyebrow flex items-center justify-between gap-2 px-4 py-3 text-ink-muted">
                {item.sector}
                <span className="flex items-center gap-1 font-bold text-federal-blue">
                  Open <Icon name="arrow" size={14} />
                </span>
              </p>
              <motion.span
                aria-hidden="true"
                className="drum-shade"
                style={at(position, index)}
              />
            </div>
          </motion.article>
        ))}
      </div>
    </div>
  );
}
