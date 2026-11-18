"use client";

import type { CSSProperties } from "react";
import { Chapter, useChapterProgress } from "@/components/motion/chapter";
import { Count } from "@/components/motion/count";
import { Peel } from "@/components/motion/peel";
import { easeOut, seg, within } from "@/components/motion/scroll-math";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { road, sceneNumber, who } from "@/content/landing";
import { highlights, profile } from "@/content/profile";
import "./landing.css";

/** The opening lines come in over this part of the chapter… */
const LINES = [0, 0.3] as const;
/** …the road is travelled over this part… */
const ROAD = [0.12, 0.9] as const;
/** …and the figures count up over this part. */
const FIGURES = [0.3, 0.6] as const;

/** Where on the road each stop is reached. */
const stopAt = road.map((_, index) =>
  within(...ROAD, index / (road.length - 1)),
);

/**
 * Who's reading: four short lines, the last one declassified, and the road
 * from 2019 to today, travelled as you scroll: each job pops up off the rail
 * as the marker reaches it, and the ones behind it settle back.
 */
export function WhoChapter() {
  return (
    <Chapter
      id="who"
      label="Who's reading"
      length={3.3}
      overlap
      className="bg-ink text-paper"
      stageClassName="bg-ink text-paper [--peel-bar:var(--color-brass)] [--peel-edge:var(--color-clear-sky)]"
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col justify-center gap-5 px-4 py-5 sm:px-6 lg:gap-8 lg:py-8">
        <div className="lg:grid lg:grid-cols-[1.3fr_1fr] lg:items-end lg:gap-14">
          <div>
            <p className="eyebrow mb-3 text-clear-sky lg:mb-5">
              {sceneNumber("who")} · Who's reading
            </p>
            <Lines />
          </div>
          <div>
            <Figures />
            <div className="mt-6 hidden items-center gap-6 lg:flex">
              <p className="font-mono text-sm tracking-[0.1em] text-marble uppercase">
                {profile.location}
              </p>
              <ButtonLink href="/about" variant="secondary">
                The longer story
                <Icon name="arrow" size={18} />
              </ButtonLink>
            </div>
          </div>
        </div>

        <Road />
      </div>
    </Chapter>
  );
}

/** The first lines rise in one after another; the last is declassified. */
function Lines() {
  const step = (LINES[1] - LINES[0]) / who.lines.length;
  return (
    <h2 className="space-y-1.5 font-mono text-[clamp(1.2rem,min(5.6vw,4.4svh),2.5rem)] leading-[1.12] font-bold uppercase lg:space-y-2">
      {who.lines.map((line, index) => {
        const from = LINES[0] + index * step;
        const last = index === who.lines.length - 1;
        if (last)
          return (
            <Peel
              key={line}
              text={line}
              timing={{ on: "chapter", from, to: from + step * 1.4 }}
              className="block text-brass"
            />
          );
        const t = easeOut(seg(from - step, from + step * 0.6));
        return (
          <span
            key={line}
            className="block"
            style={{
              opacity: `calc(0.12 + 0.88 * ${t})`,
              transform: `translateY(calc(0.5em * (1 - ${t})))`,
            }}
          >
            {line}
          </span>
        );
      })}
    </h2>
  );
}

function Figures() {
  const progress = useChapterProgress();
  return (
    <dl className="mt-5 grid grid-cols-4 gap-3 border-paper/25 border-t-2 pt-4 lg:mt-0 lg:grid-cols-2 lg:gap-x-6 lg:gap-y-5 lg:border-t-0 lg:pt-0">
      {highlights.map((metric, index) => {
        const from = within(...FIGURES, index * 0.2);
        return (
          <div
            key={metric.label}
            style={{ opacity: `calc(0.3 + 0.7 * ${seg(from, from + 0.06)})` }}
          >
            <dt className="sr-only">{metric.label}</dt>
            <dd>
              <Count
                figure={metric.figure}
                progress={progress}
                from={from}
                to={from + 0.15}
                className="block font-mono text-lg leading-none font-bold whitespace-nowrap sm:text-3xl lg:text-4xl"
              />
              <span
                aria-hidden="true"
                className="mt-1.5 block text-[0.6875rem] leading-snug text-marble sm:text-xs lg:text-sm [@media(max-height:620px)]:hidden"
              >
                {metric.label}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * 2019 to today along one rail. On a computer each job's card pops up off the
 * rail when the marker reaches it; on a phone the reached job's card shows
 * under the rail.
 */
function Road() {
  const travelled = seg(...ROAD);
  return (
    <div>
      <p className="eyebrow mb-3 text-clear-sky">The road here</p>

      <ol className="relative grid grid-cols-6 gap-2 lg:gap-3">
        {road.map((stop, index) => {
          const next = stopAt[index + 1] ?? 2;
          return (
            <li
              key={stop.company}
              className="road-stop flex flex-col justify-end"
              style={
                {
                  "--reached": seg(stopAt[index] - 0.035, stopAt[index]),
                  "--passed": seg(next - 0.035, next),
                } as CSSProperties
              }
            >
              {/* On a computer: the job's card, standing on the rail. */}
              <span className="road-card mb-3 hidden border-2 border-paper bg-ink p-3 shadow-[4px_4px_0_var(--color-brass)] lg:block">
                <span className="block font-mono text-sm font-bold text-brass">
                  {stop.year}
                </span>
                <span className="mt-1 block font-mono text-xs font-bold uppercase">
                  {stop.short}
                </span>
                <span className="mt-1.5 block text-[0.8125rem] leading-snug text-marble [@media(max-height:700px)]:hidden">
                  {stop.what}
                </span>
              </span>
              <span className="road-year font-mono text-xs font-bold lg:hidden">
                {stop.year}
                <span className="sr-only">
                  {" "}
                  · {stop.short}: {stop.what}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {/* The rail, the travelled part in brass, and the marker riding it. */}
      <div aria-hidden="true" className="relative mt-2 h-4">
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-paper/20" />
        <span
          className="absolute inset-x-0 top-1/2 h-1 origin-left bg-brass"
          style={{ transform: `translateY(-50%) scaleX(${travelled})` }}
        />
        <span
          className="absolute inset-x-0 top-1/2 h-4"
          style={{
            transform: `translate(calc(${travelled} * (100% - 1rem)), -50%)`,
          }}
        >
          <span className="block size-4 rounded-full border-2 border-paper bg-brass" />
        </span>
      </div>

      {/* On a phone: the reached job's card under the rail. */}
      <div aria-hidden="true" className="relative mt-3 h-[5.5rem] lg:hidden">
        {road.map((stop, index) => {
          const next = stopAt[index + 1] ?? 2;
          const shown = `calc(${seg(stopAt[index] - 0.035, stopAt[index])} * (1 - ${seg(next - 0.035, next)}))`;
          return (
            <p
              key={stop.company}
              className="absolute inset-0 border-2 border-paper bg-ink p-3 text-sm leading-snug text-marble shadow-[4px_4px_0_var(--color-brass)]"
              style={{
                opacity: shown,
                transform: `translateY(calc(0.5rem * (1 - ${shown})))`,
              }}
            >
              <span className="font-mono font-bold text-paper">
                {stop.year} · {stop.short}.
              </span>{" "}
              {stop.what}
            </p>
          );
        })}
      </div>
    </div>
  );
}
