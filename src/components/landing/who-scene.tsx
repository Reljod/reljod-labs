"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { highlightStories, sceneNumber, who } from "@/content/landing";
import { highlights, profile } from "@/content/profile";
import type { Metric } from "@/content/types";
import { RevealWords, Rise } from "./reveal";

/** Who made the site, a line at a time, and the numbers behind it as cards that flip. */
export function WhoScene() {
  return (
    <section
      id="who"
      aria-labelledby="who-title"
      className="border-ink border-t-2 bg-ink text-paper"
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:py-28">
        <div>
          <p className="eyebrow mb-6 text-clear-sky">
            {sceneNumber("who")} · Who's at the desk
          </p>
          <h2
            id="who-title"
            className="space-y-3 font-mono text-3xl leading-[1.12] font-bold uppercase sm:text-4xl"
          >
            {who.lines.map((line, index) => (
              <RevealWords
                key={line}
                text={line}
                delay={index * 0.08}
                className={`block ${index === who.lines.length - 1 ? "text-brass" : ""}`}
              />
            ))}
          </h2>
          <Rise delay={0.2} className="mt-8">
            <p className="font-mono text-sm tracking-[0.1em] text-marble uppercase">
              {profile.location}
            </p>
            <div className="mt-6">
              <ButtonLink href="/about" variant="secondary">
                The longer story
                <Icon name="arrow" size={18} />
              </ButtonLink>
            </div>
          </Rise>
        </div>

        <div>
          <p className="eyebrow mb-4 text-marble">{who.flipHint}</p>
          <ul className="grid grid-cols-2 gap-4">
            {highlights.map((metric, index) => (
              <li key={metric.label}>
                <Rise delay={index * 0.07}>
                  <FlipCard metric={metric} />
                </Rise>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FlipCard({ metric }: { metric: Metric }) {
  const [flipped, setFlipped] = useState(false);
  const face =
    "absolute inset-0 flex flex-col border-2 border-paper p-4 [backface-visibility:hidden]";
  return (
    <button
      type="button"
      aria-pressed={flipped}
      onClick={() => setFlipped((current) => !current)}
      className="group block h-60 w-full cursor-pointer text-left [perspective:900px] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-clear-sky sm:h-52"
    >
      <motion.span
        className="relative block size-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <span
          aria-hidden={flipped}
          className={`${face} bg-ink transition-colors group-hover:bg-federal-blue`}
        >
          <span className="font-mono text-3xl leading-tight font-bold sm:text-4xl">
            {metric.figure}
          </span>
          <span className="mt-2 text-sm text-marble">{metric.label}</span>
          <span className="eyebrow mt-auto flex items-center gap-1 text-clear-sky">
            Story <Icon name="arrow" size={12} />
          </span>
        </span>
        <span
          aria-hidden={!flipped}
          className={`${face} bg-paper text-ink [transform:rotateY(180deg)]`}
        >
          <span className="eyebrow text-ink-muted">{metric.source}</span>
          <span className="mt-2 text-[0.8125rem] leading-snug sm:text-sm">
            {highlightStories[metric.label]}
          </span>
        </span>
      </motion.span>
    </button>
  );
}
