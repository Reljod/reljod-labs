"use client";

import type { CSSProperties } from "react";
import { Chapter, useChapterProgress } from "@/components/motion/chapter";
import { Count } from "@/components/motion/count";
import { Peel } from "@/components/motion/peel";
import { seg, within } from "@/components/motion/scroll-math";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { road, sceneNumber, who } from "@/content/landing";
import { highlights, profile } from "@/content/profile";

const LINES = [0.02, 0.48] as const;
const ROAD = [0.08, 0.9] as const;
const FIGURES = [0.55, 0.85] as const;

/** Where on the road each stop lights up. */
const stopAt = road.map((_, index) =>
  within(...ROAD, index / (road.length - 1)),
);

/** Who's reading: the story declassified line by line, and the road here. */
export function WhoChapter() {
  return (
    <Chapter
      id="who"
      label="Who's reading"
      length={2.5}
      className="bg-ink text-paper"
      stageClassName="bg-ink text-paper [--peel-bar:var(--color-brass)] [--peel-edge:var(--color-clear-sky)]"
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col justify-center gap-6 px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14">
        <div>
          <p className="eyebrow mb-4 text-clear-sky lg:mb-6">
            {sceneNumber("who")} · Who's reading
          </p>
          <h2 className="space-y-2 font-mono text-[1.55rem] leading-[1.12] font-bold uppercase sm:text-4xl lg:space-y-3 lg:text-[2.6rem]">
            {who.lines.map((line, index) => {
              const width = (LINES[1] - LINES[0]) / who.lines.length;
              const from = LINES[0] + index * width;
              return (
                <Peel
                  key={line}
                  text={line}
                  timing={{ on: "chapter", from, to: from + width * 1.1 }}
                  className={`block ${index === who.lines.length - 1 ? "text-brass" : ""}`}
                />
              );
            })}
          </h2>
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

        <Road />
      </div>
    </Chapter>
  );
}

function Figures() {
  const progress = useChapterProgress();
  return (
    <dl className="mt-6 grid grid-cols-4 gap-3 border-paper/25 border-t-2 pt-4 lg:mt-10 lg:gap-5">
      {highlights.map((metric, index) => {
        const from = within(...FIGURES, index * 0.15);
        return (
          <div
            key={metric.label}
            style={{ opacity: `calc(0.25 + 0.75 * ${seg(from, from + 0.1)})` }}
          >
            <dt className="sr-only">{metric.label}</dt>
            <dd>
              <Count
                figure={metric.figure}
                progress={progress}
                from={from}
                to={from + 0.3}
                className="block font-mono text-lg leading-none font-bold whitespace-nowrap sm:text-3xl"
              />
              <span
                aria-hidden="true"
                className="mt-2 block text-[0.6875rem] leading-snug text-marble sm:text-xs"
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

/** 2019 to today: a rail that fills as you scroll, each job lighting up as it's reached. */
function Road() {
  const fill = seg(...ROAD);
  return (
    <div>
      <p className="eyebrow mb-3 text-clear-sky lg:mb-5">The road here</p>
      <div className="relative">
        {/* The rail: across on a phone, down on a computer. */}
        <span className="absolute top-[0.55rem] right-2 left-2 h-0.5 bg-paper/20 lg:top-2 lg:right-auto lg:bottom-2 lg:left-[0.45rem] lg:h-auto lg:w-0.5" />
        <span
          className="absolute top-[0.55rem] right-2 left-2 h-0.5 origin-left bg-brass lg:hidden"
          style={{ transform: `scaleX(${fill})` }}
        />
        <span
          className="absolute top-2 bottom-2 left-[0.45rem] hidden w-0.5 origin-top bg-brass lg:block"
          style={{ transform: `scaleY(${fill})` }}
        />
        <ol className="relative flex justify-between lg:flex-col lg:gap-5">
          {road.map((stop, index) => {
            const lit = seg(stopAt[index] - 0.03, stopAt[index] + 0.01);
            return (
              <li
                key={stop.company}
                className="flex flex-col items-center gap-2 lg:flex-row lg:items-start lg:gap-4"
                style={{ "--lit": lit } as CSSProperties}
              >
                <span
                  aria-hidden="true"
                  className="road-dot relative mt-0.5 size-3 shrink-0 rounded-full border-2 border-paper bg-ink"
                />
                <span className="road-text">
                  <span className="block font-mono text-xs font-bold lg:text-sm">
                    {stop.year}
                    <span className="max-lg:sr-only"> · {stop.short}</span>
                  </span>
                  <span className="mt-1 block max-w-md text-sm leading-snug text-marble max-lg:sr-only">
                    {stop.what}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* On a phone the reached stop's story shows under the rail. */}
      <div aria-hidden="true" className="relative mt-4 h-16 lg:hidden">
        {road.map((stop, index) => {
          const from = stopAt[index] - 0.03;
          const to = stopAt[index + 1] ? stopAt[index + 1] - 0.03 : 2;
          const fade = 0.02;
          return (
            <p
              key={stop.company}
              className="absolute inset-0 text-sm leading-snug text-marble"
              style={{
                opacity: `calc(${seg(from - fade, from + fade)} * (1 - ${seg(to - fade, to + fade)}))`,
              }}
            >
              <span className="font-mono font-bold text-paper">
                {stop.short}.
              </span>{" "}
              {stop.what}
            </p>
          );
        })}
      </div>
    </div>
  );
}
