"use client";

import { useMotionValueEvent } from "motion/react";
import type { CSSProperties } from "react";
import { useRef } from "react";
import { Chapter, useChapterProgress } from "@/components/motion/chapter";
import { Peel } from "@/components/motion/peel";
import {
  bump,
  easeOut,
  mix,
  seg,
  smooth,
  stagger,
  within,
} from "@/components/motion/scroll-math";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { opening } from "@/content/landing";
import "./landing.css";

/** Sheets drawn for the pile; they stand for all `opening.pages`. */
const SHEETS = 14;
/** The first few are on the desk before you scroll. */
const ON_DESK = 3;
/** Pages fly onto the pile over this part of the chapter… */
const ARRIVE = [0.02, 0.36] as const;
/** …and pass through the reader over this part. */
const READ = [0.4, 0.84] as const;
const ANSWER = [0.86, 0.97] as const;
/** Sheets that come out with a red tab: the pages a person must see. */
const FLAGGED = new Set([3, 8, 11]);

/** Stable pseudo-random in [-1, 1], so server and browser agree. */
function jitter(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const arriveAt = stagger(SHEETS - ON_DESK, 0.16);
const readAt = stagger(SHEETS, 0.12);

function sheetStyle(index: number): CSSProperties {
  // Where it starts (off the machine), lands (the messy pile) and ends (the neat stack).
  // They rise from below the desk, so they never cross the headline.
  const x0 = 50 + jitter(index, 1) * 60;
  const y0 = 175 + jitter(index, 6) * 25;
  const r0 = jitter(index, 2) * 70;
  const xp = 24 + jitter(index, 3) * 6;
  const yp = 54 - index * 0.9 + jitter(index, 4) * 3;
  const rp = jitter(index, 5) * 16;
  const xn = 76;
  const yn = 54 - index * 0.9;
  const rn = index % 2 ? 0.8 : -0.8;

  const arrive =
    index < ON_DESK
      ? "1"
      : easeOut(
          seg(
            within(...ARRIVE, arriveAt[index - ON_DESK]),
            within(...ARRIVE, arriveAt[index - ON_DESK] + 0.16),
          ),
        );
  const readStart = within(...READ, readAt[index]);
  const readEnd = within(...READ, readAt[index] + 0.12);
  const passLinear = seg(readStart, readEnd);
  const pass = smooth(passLinear);
  const settled = index < ON_DESK;

  return {
    "--lit": seg(
      within(readStart, readEnd, 0.45),
      within(readStart, readEnd, 0.6),
    ),
    transform: [
      `translate(calc(${settled ? `${xp}cqw` : mix(x0, xp, arrive, "cqw")} + ${xn - xp}cqw * ${pass} - 14cqmin),`,
      `calc(${settled ? `${yp}cqh` : mix(y0, yp, arrive, "cqh")} + ${yn - yp}cqh * ${pass} - 9cqh * ${bump(passLinear)} - 18cqmin))`,
      `rotate(calc(${settled ? `${rp}deg` : mix(r0, rp, arrive, "deg")} + ${rn - rp}deg * ${pass}))`,
    ].join(" "),
  } as CSSProperties;
}

/**
 * The opening chapter. The second line of the headline is redacted until you
 * scroll; meanwhile a pile of paper lands on the desk, passes through the
 * reader and comes out tidy, with the pages a person must see tabbed red.
 */
export function OpeningChapter() {
  return (
    <Chapter
      id="top"
      label="Paperwork"
      length={2.9}
      className="border-t-0 bg-marble"
      stageClassName="bg-marble bg-[linear-gradient(rgb(20_33_61/0.05)_2px,transparent_2px),linear-gradient(90deg,rgb(20_33_61/0.05)_2px,transparent_2px)] bg-size-[40px_40px]"
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-5 px-4 pt-6 pb-16 sm:px-6 lg:grid lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12 lg:py-10">
        <div className="relative z-10">
          <p className="eyebrow mb-4 text-ink-muted lg:mb-6">
            {opening.eyebrow}
          </p>
          <h1 className="font-mono text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] uppercase sm:text-5xl lg:text-6xl">
            <Peel
              text={opening.lines[0]}
              timing={{ on: "mount", delay: 0.2, duration: 0.9 }}
              className="block"
            />
            <Peel
              text={opening.lines[1]}
              timing={{ on: "chapter", from: 0.03, to: 0.26 }}
              className="block text-federal-blue"
            />
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed sm:text-lg lg:mt-6 lg:text-xl [@media(max-width:1023px)_and_(max-height:760px)]:hidden">
            {opening.intro}
          </p>
          <div className="mt-5 flex flex-wrap gap-3 lg:mt-8 lg:gap-4">
            <ButtonLink href="#demos">
              See the projects
              <Icon name="arrow" size={18} />
            </ButtonLink>
            <ButtonLink href="#everything" variant="secondary">
              Skip the tour
            </ButtonLink>
          </div>
        </div>

        <Reader />
      </div>

      <p
        aria-hidden="true"
        className="eyebrow absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 text-ink-muted"
        style={{ opacity: `calc(1 - ${seg(0, 0.06)})` }}
      >
        <span className="scroll-cue" />
        {opening.cue}
      </p>
    </Chapter>
  );
}

/** The machine: a messy pile, the reader in the middle, a neat stack. */
function Reader() {
  const progress = useChapterProgress();
  const readRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);

  // The counters follow the pages through the reader, without a re-render.
  useMotionValueEvent(progress, "change", (p) => {
    const t = Math.min(1, Math.max(0, (p - READ[0]) / (READ[1] - READ[0])));
    const read = Math.round(opening.pages * t);
    if (readRef.current) readRef.current.textContent = String(read);
    if (leftRef.current)
      leftRef.current.textContent = String(opening.pages - read);
  });

  const answer = smooth(seg(...ANSWER));

  return (
    <div
      className="relative min-h-0 flex-1 [container-type:size] lg:aspect-square lg:h-auto lg:max-h-full lg:flex-none"
      aria-label={`A pile of ${opening.pages} pages passes through the AI and comes out read, with ${opening.flags.length} pages tabbed for a person.`}
      role="img"
    >
      <div
        className="absolute inset-0"
        style={{
          opacity: `calc(1 - 0.55 * ${answer})`,
          transform: `translateY(calc(-4cqh * ${answer}))`,
        }}
      >
        {/* Desk line and trays. */}
        <span className="absolute inset-x-[4cqw] top-[64cqh] h-[0.6cqmin] bg-ink" />
        <span className="absolute top-[67cqh] left-[24cqw] -translate-x-1/2 text-center font-mono text-[3.2cqmin] leading-tight font-bold uppercase">
          Unread
          <span
            ref={leftRef}
            className="block text-[6cqmin] text-ink tabular-nums"
          >
            {opening.pages}
          </span>
        </span>
        <span className="absolute top-[67cqh] left-[76cqw] -translate-x-1/2 text-center font-mono text-[3.2cqmin] leading-tight font-bold text-federal-blue uppercase">
          Read
          <span ref={readRef} className="block text-[6cqmin] tabular-nums">
            0
          </span>
        </span>

        {/* The reader: a gate of light the pages pass through. */}
        <span
          className="reader-beam absolute top-[14cqh] left-1/2 h-[50cqh] w-[5cqmin] -translate-x-1/2"
          style={{ "--glow": bump(seg(...READ)) } as CSSProperties}
        />
        <span className="absolute top-[9cqh] left-1/2 flex h-[6cqh] w-[16cqmin] -translate-x-1/2 items-center justify-center rounded-sm border-2 border-ink bg-ink font-mono text-[2.8cqmin] font-bold tracking-[0.12em] text-paper">
          AI
        </span>
        <span className="absolute top-[63cqh] left-1/2 h-[2.4cqh] w-[16cqmin] -translate-x-1/2 rounded-sm border-2 border-ink bg-limestone" />

        {Array.from({ length: SHEETS }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: sheets are drawn, not data.
            key={index}
            className="sheet absolute top-0 left-0 flex h-[36cqmin] w-[28cqmin] flex-col gap-[2.2cqmin] border-2 border-ink bg-paper p-[2.6cqmin] shadow-hard-sm"
            style={sheetStyle(index)}
          >
            <span className="sheet-line w-3/5 bg-ink/70" />
            <span className="sheet-line w-full" />
            <span className="sheet-line sheet-lit w-4/5" />
            <span className="sheet-line w-full" />
            <span className="sheet-line sheet-lit w-2/3" />
            <span className="sheet-line w-5/6" />
            {FLAGGED.has(index) ? <span className="sheet-tab" /> : null}
          </span>
        ))}
      </div>

      <div
        className="absolute top-[18cqh] left-1/2 w-[min(86cqw,30rem)] border-2 border-ink bg-paper shadow-hard-lg"
        style={{
          opacity: answer,
          transform: `translate(-50%, calc(14cqh * (1 - ${answer}))) rotate(calc(-1.5deg * (1 - ${answer})))`,
        }}
      >
        <p className="border-ink border-b-2 bg-ink px-[4cqmin] py-[2cqmin] font-mono text-[3cqmin] font-bold tracking-[0.1em] text-paper uppercase">
          {opening.pages} pages read · {opening.flags.length} for a person
        </p>
        <ul className="divide-y-2 divide-ink/15">
          {opening.flags.map((flag, index) => (
            <li
              key={flag.text}
              className="flex items-center gap-[3cqmin] px-[4cqmin] py-[2.4cqmin] text-[3.8cqmin] font-semibold"
              style={{
                opacity: seg(
                  within(...ANSWER, 0.3 + index * 0.15),
                  within(...ANSWER, 0.55 + index * 0.15),
                ),
              }}
            >
              <span className="size-[2.6cqmin] shrink-0 bg-seal-red" />
              {flag.text}
              <span className="ml-auto font-mono text-[3cqmin] text-ink-muted">
                p.&nbsp;{flag.page}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
