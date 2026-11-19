"use client";

import {
  type CSSProperties,
  type MouseEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import { useCopyMotion } from "@/components/motion/copy-motion";
import { useReduced } from "@/components/motion/use-reduced";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { experience } from "@/content/experience";
import type { Experience, ExperienceSector } from "@/content/types";
import { source, sourcePath } from "@/features/ledger/domain/source-paths";
import type { Ruler } from "./career-span";
import "./about.css";

const sectorTone: Record<ExperienceSector, BadgeTone> = {
  Banking: "ink",
  "Financial data": "haze",
  "AI SaaS": "paper",
  Consulting: "paper",
  Hardware: "limestone",
};

/**
 * The jobs oldest first, so the file builds up to now. Each keeps its index in
 * `experience`, which Ledger's source paths name.
 */
const FILED = experience
  .map((job, index) => ({ job, index }))
  .reverse()
  .map((entry, place) => ({ ...entry, place }));

const placeOf = (index: number) => experience.length - 1 - index;
const fileNumber = (place: number) => String(place + 1).padStart(2, "0");
const anchor = (place: number) => `job-${fileNumber(place)}`;

/**
 * Experience as a file of index cards. On the moving About page each card
 * rises into place, its start year rolls up like an odometer and its dates
 * stamp on, and on a tall enough screen the cards pile onto each other as you
 * scroll, oldest at the bottom. Everywhere else (Ledger's Ask copy) the same
 * cards sit still in a plain list.
 */
export function CareerFile({ ruler }: { ruler: Ruler }) {
  const animated = useCopyMotion();
  const reduce = useReduced();
  const list = useRef<HTMLOListElement>(null);
  const stops = usePile(list, animated);

  // On the moving page the cards are sticky, which throws a plain anchor jump
  // off; scroll to where the card settles instead.
  function jump(event: MouseEvent<HTMLAnchorElement>, place: number) {
    const top = stops.current[place];
    if (!animated || top === undefined) return;
    event.preventDefault();
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className="career-file" data-animated={animated ? "" : undefined}>
      <CareerRuler ruler={ruler} onJump={jump} />
      <ol ref={list} className="career-stack" aria-label="Jobs, oldest first">
        {FILED.map(({ job, index, place }) => (
          <CareerCard
            key={`${job.company}-${job.period}`}
            job={job}
            index={index}
            place={place}
          />
        ))}
      </ol>
    </div>
  );
}

function CareerRuler({
  ruler,
  onJump,
}: {
  ruler: Ruler;
  onJump: (event: MouseEvent<HTMLAnchorElement>, place: number) => void;
}) {
  if (ruler.jobs.length === 0) return null;
  return (
    <nav aria-label="Career timeline" className="career-ruler mb-16">
      <div className="outline-box relative h-14 bg-paper shadow-hard-md">
        {ruler.years.map(({ year, at }) => (
          <span
            key={year}
            aria-hidden="true"
            className="absolute top-0 h-2 w-0.5 bg-ink"
            style={{ left: `${at * 100}%` }}
          />
        ))}
        {ruler.jobs.map(({ index, left, width }) => {
          const job = experience[index];
          const place = placeOf(index);
          return (
            <a
              key={index}
              href={`#${anchor(place)}`}
              onClick={(event) => onJump(event, place)}
              aria-label={`${job.role} at ${job.company}, ${job.period}`}
              title={`${job.role} · ${job.company}`}
              className={`career-seg absolute inset-y-0 flex items-center gap-2 overflow-hidden px-1 font-mono text-[0.6rem] font-bold uppercase sm:px-2 sm:text-xs ${left > 0 ? "border-ink border-l-2" : ""} ${job.highlight ? "bg-morning-haze" : ""}`}
              style={
                {
                  left: `${left * 100}%`,
                  width: `${width * 100}%`,
                  "--place": place,
                } as CSSProperties
              }
            >
              <span>{fileNumber(place)}</span>
              {width > 0.16 ? (
                <span className="hidden truncate font-medium md:inline">
                  {job.company}
                </span>
              ) : null}
            </a>
          );
        })}
      </div>
      <div aria-hidden="true" className="relative mt-2 h-4">
        {ruler.years.map(({ year, at }) => (
          <span
            key={year}
            className="absolute -translate-x-1/2 font-mono text-[0.65rem] text-ink-muted first:translate-x-0 last:-translate-x-full sm:text-xs"
            style={{ left: `${at * 100}%` }}
          >
            {year}
          </span>
        ))}
      </div>
    </nav>
  );
}

function CareerCard({
  job,
  index,
  place,
}: {
  job: Experience;
  index: number;
  place: number;
}) {
  const year = /\d{4}/.exec(job.period)?.[0] ?? "";
  return (
    <li
      id={anchor(place)}
      className={`career-card ${job.highlight ? "career-card-highlight" : ""}`}
      style={{ "--i": place } as CSSProperties}
      {...source(sourcePath.job(index))}
    >
      <span aria-hidden="true" className="career-tab">
        No. {fileNumber(place)}
        <span className="text-ink-muted">· {job.sector}</span>
      </span>
      <article className="career-sheet outline-box relative overflow-hidden shadow-hard-lg">
        <div className="relative grid gap-6 p-6 sm:p-8 md:grid-cols-[12.5rem_1fr] md:gap-10">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3 md:block">
            <Odometer value={year} />
            <div className="md:mt-5">
              <p className="career-stamp">{job.period}</p>
              <p className="mt-3 text-sm text-ink-muted">{job.location}</p>
              <div className="mt-3">
                <Badge tone={sectorTone[job.sector]}>{job.sector}</Badge>
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="text-[1.5rem] leading-snug font-semibold">
              {job.role}
            </h3>
            <p className="mt-1 font-mono text-sm font-bold tracking-[0.06em] text-federal-blue uppercase">
              {job.company}
            </p>
            <span aria-hidden="true" className="career-rule" />
            <ul className="mt-5 space-y-3">
              {job.points.map((point, pointIndex) => (
                <li
                  key={point}
                  className="career-point flex gap-3"
                  style={{ "--k": pointIndex } as CSSProperties}
                  {...source(sourcePath.jobPoint(index, pointIndex))}
                >
                  <span
                    aria-hidden="true"
                    className="mt-2.5 h-0.5 w-3 shrink-0 bg-brass"
                  />
                  {point}
                </li>
              ))}
            </ul>
            <ul aria-label="Stack" className="mt-5 flex flex-wrap gap-2">
              {job.stack.map((item) => (
                <li
                  key={item}
                  className="eyebrow outline-box rounded-sm bg-paper px-2 py-0.5"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <span aria-hidden="true" className="career-shade" />
      </article>
    </li>
  );
}

/** A year whose digits roll up from 0 like an odometer as the card rises. */
function Odometer({ value }: { value: string }) {
  return (
    <p aria-hidden="true" className="career-year">
      {[...value].map((digit, place) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a digit's place is its identity.
          key={place}
          className="odo"
          style={{ "--k": place, "--digit": Number(digit) } as CSSProperties}
        >
          <span className="odo-reel">
            {"0123456789".split("").map((face) => (
              <span key={face}>{face}</span>
            ))}
          </span>
        </span>
      ))}
    </p>
  );
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Drives the cards from the page's scroll without re-rendering React: each
 * card gets `--q` (0..1, how far it has risen into place) and `--depth` (how
 * many cards now lie on it). Returns, per card, the scroll position at which
 * it settles, for the ruler's jumps.
 */
function usePile(
  list: RefObject<HTMLOListElement | null>,
  animated: boolean,
): RefObject<number[]> {
  const stops = useRef<number[]>([]);

  useEffect(() => {
    const element = list.current;
    if (!animated || !element) return;
    const cards = [...element.children] as HTMLElement[];
    let natural: number[] = [];
    let heights: number[] = [];
    let tops: number[] = [];
    let viewport = window.innerHeight;
    let frame = 0;

    // Layout is read here only, never while painting. A sticky card's own
    // position moves as it sticks, so each card's place in the flow is added
    // up from the list's top and the heights before it.
    function measure() {
      if (!element) return;
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.rowGap) || 0;
      let y =
        element.getBoundingClientRect().top +
        window.scrollY +
        (Number.parseFloat(style.paddingTop) || 0);
      natural = [];
      heights = [];
      tops = [];
      for (const card of cards) {
        natural.push(y);
        heights.push(card.offsetHeight);
        y += card.offsetHeight + gap;
        // "auto" (not sticky: a small screen) reads as NaN.
        tops.push(Number.parseFloat(getComputedStyle(card).top));
      }
      viewport = window.innerHeight;
      const header = 4.125 * 16 + 40;
      stops.current = natural.map(
        (top, index) =>
          top - (Number.isFinite(tops[index]) ? tops[index] : header),
      );
      paint();
    }

    function paint() {
      frame = 0;
      const y = window.scrollY;
      const covers = cards.map((_, index) => {
        const next = index + 1;
        if (
          next >= cards.length ||
          !Number.isFinite(tops[index]) ||
          !Number.isFinite(tops[next])
        ) {
          return 0;
        }
        // The next card starts to cover this one when its top reaches this
        // card's bottom, and has covered it when it settles.
        const from = natural[next] - tops[index] - heights[index];
        const to = natural[next] - tops[next];
        return to > from ? clamp01((y - from) / (to - from)) : y >= to ? 1 : 0;
      });
      let depth = 0;
      for (let index = cards.length - 1; index >= 0; index -= 1) {
        depth += covers[index];
        const rise = clamp01(
          (y - (natural[index] - viewport)) / (viewport * 0.6),
        );
        cards[index].style.setProperty("--q", rise.toFixed(3));
        cards[index].style.setProperty("--depth", depth.toFixed(3));
      }
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const resize = new ResizeObserver(() => measure());
    resize.observe(element);
    for (const card of cards) resize.observe(card);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      for (const card of cards) {
        card.style.removeProperty("--q");
        card.style.removeProperty("--depth");
      }
    };
  }, [list, animated]);

  return stops;
}
