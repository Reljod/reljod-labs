"use client";

import { motion, useTransform } from "motion/react";
import { Chapter, useChapterProgress } from "@/components/motion/chapter";
import { useCopyMotion } from "@/components/motion/copy-motion";
import { at, drumPosition } from "@/components/motion/drum";
import { experience } from "@/content/experience";
import "@/components/landing/landing.css";

const TURN = [0.08, 0.9] as const;

/**
 * The About page's Experience, played first as a Rolodex of jobs that turns
 * as you scroll (each card's dates stamp on as it settles), before the full
 * list below. Decoration over the list: hidden from screen readers, and not
 * rendered at all where the page copy must keep still (Ledger's Ask copy).
 */
export function CareerDrum() {
  const animated = useCopyMotion();
  if (!animated) return null;
  return (
    <div aria-hidden="true" className="mb-12 motion-reduce:hidden">
      <Chapter
        id="career"
        label="Career, card by card"
        length={1 + experience.length * 0.45}
        covered={false}
        className="border-t-0!"
      >
        <Cards />
      </Chapter>
    </div>
  );
}

function Cards() {
  const progress = useChapterProgress();
  const position = useTransform(progress, (p) =>
    drumPosition(p, experience.length, TURN),
  );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <p className="eyebrow text-ink-muted">Seven years, card by card</p>
      <div className="drum relative h-[min(26rem,70%)] w-full">
        {experience.map((job, index) => (
          <motion.article
            key={`${job.company}-${job.period}`}
            className="drum-card absolute top-1/2 left-1/2 w-[min(88vw,34rem)]"
            style={at(position, index)}
          >
            <span
              className="absolute -top-[1.85rem] flex h-[1.85rem] items-center border-2 border-ink border-b-0 bg-paper px-3 font-mono text-xs font-bold"
              style={{ left: `${6 + index * 14}%` }}
            >
              {/\d{4}/.exec(job.period)?.[0]}
            </span>
            <div
              className={`outline-box relative overflow-hidden p-6 shadow-hard-lg ${job.highlight ? "bg-morning-haze" : "bg-paper"}`}
            >
              <motion.p
                style={at(position, index)}
                className="career-date inline-block border-[3px] border-federal-blue px-2 py-1 font-mono text-sm font-bold tracking-[0.08em] text-federal-blue uppercase"
              >
                {job.period}
              </motion.p>
              <h3 className="mt-4 text-2xl leading-snug font-semibold">
                {job.role}
              </h3>
              <p className="mt-1 font-mono text-sm font-bold uppercase">
                {job.company}
              </p>
              <p className="mt-4 line-clamp-3 text-ink-muted">
                {job.points[0]}
              </p>
              <p className="eyebrow mt-4 text-ink-muted">
                {job.location} · {job.sector}
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
