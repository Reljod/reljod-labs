"use client";

import { useReducedMotion } from "motion/react";
import Link from "next/link";
import {
  type FocusEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { BrowserFrame } from "@/components/showcase/browser-frame";
import { Icon } from "@/components/ui/icon";
import { LiveBadge } from "@/components/ui/live-badge";
import { ProjectMarks } from "@/components/ui/project-marks";
import { catalog } from "@/content/landing";
import { type CatalogEntry, hiddenMatch } from "./catalog-query";
import { Highlight } from "./highlight";
import { LazyPreview } from "./lazy-preview";
import { useCanHover } from "./use-can-hover";

/** Where "Surprise me" has a card: the light passing over it, the pick, or dimmed behind the pick. */
export type Spot = "roll" | "picked" | "dim";

/** Tilt, in degrees, at the card's edge. */
const TILT = 5;

/**
 * One demo as an index card. Its preview is a paused film until you hover
 * it (or focus it, or on a touch screen scroll it to the middle), then it
 * warms up and plays.
 */
export function CatalogCard({
  entry,
  wide,
  terms,
  spot,
  onTag,
  onHover,
}: {
  entry: CatalogEntry;
  /** Classes that set how many columns the card takes and whether it lies on its side. */
  wide: { md: boolean; lg: boolean };
  terms: string[];
  spot?: Spot;
  onTag: (tag: string) => void;
  onHover: (slug: string) => void;
}) {
  const { demo } = entry;
  const href = demo.href ?? "#everything";
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const canHover = useCanHover();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const centered = useCentered(ref, !canHover);
  const playing =
    hovered || focused || spot === "picked" || (!canHover && centered);
  const why = hiddenMatch(entry, terms);

  function tilt(event: PointerEvent<HTMLDivElement>) {
    const element = ref.current;
    if (!element || reduce || event.pointerType !== "mouse") return;
    const box = element.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    // Written straight to the element so the pointer never re-renders the card.
    element.style.setProperty(
      "--ry",
      `${((x - 0.5) * 2 * TILT).toFixed(2)}deg`,
    );
    element.style.setProperty(
      "--rx",
      `${((0.5 - y) * 2 * TILT).toFixed(2)}deg`,
    );
    element.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    element.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  }

  function rest() {
    setHovered(false);
    const element = ref.current;
    if (!element) return;
    element.style.removeProperty("--rx");
    element.style.removeProperty("--ry");
  }

  const side = `${wide.md ? "md:grid-cols-[1.15fr_1fr]" : ""} ${wide.lg ? "lg:grid-cols-[1.15fr_1fr]" : "lg:grid-cols-1"}`;
  const stageEdge = `${wide.md ? "md:border-r-2 md:border-b-0" : ""} ${wide.lg ? "lg:border-r-2 lg:border-b-0" : "lg:border-r-0 lg:border-b-2"}`;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only play the preview; the card's link and tag buttons are the controls
    <div
      ref={ref}
      id={`catalog-${demo.slug}`}
      className="catalog-card relative h-full pt-[1.6rem]"
      data-playing={playing || undefined}
      data-spot={spot}
      onPointerEnter={() => {
        setHovered(true);
        onHover(demo.slug);
      }}
      onPointerMove={tilt}
      onPointerLeave={rest}
      onFocus={() => setFocused(true)}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <article className="catalog-face outline-box relative flex h-full flex-col bg-paper shadow-hard-md">
        <span className="catalog-tab absolute -top-[1.6rem] left-5 flex h-[1.6rem] items-center gap-1.5 border-2 border-ink border-b-0 bg-paper px-2.5 font-mono text-xs font-bold">
          <span className="text-ink-muted">No.</span> {entry.number}
        </span>

        <div className={`grid flex-1 ${side}`}>
          <div
            className={`flex flex-col justify-center border-ink border-b-2 bg-limestone p-4 lg:p-5 ${stageEdge}`}
          >
            <div className="relative">
              <BrowserFrame address={href}>
                <div
                  className="catalog-preview relative"
                  data-playing={playing || undefined}
                >
                  <LazyPreview demo={demo} />
                  {playing && !reduce ? (
                    <span aria-hidden="true" className="catalog-power" />
                  ) : null}
                </div>
              </BrowserFrame>
              <span
                aria-hidden="true"
                className="catalog-status eyebrow pointer-events-none absolute right-2.5 bottom-2.5 z-[2] flex items-center gap-1.5 rounded-sm border-2 border-ink px-1.5 py-0.5 text-[0.625rem] font-bold"
              >
                {playing ? (
                  <>
                    <span className="catalog-rec size-1.5 rounded-full bg-paper" />
                    Playing
                  </>
                ) : (
                  <>▶ {canHover ? "Hover to play" : "Paused"}</>
                )}
              </span>
              {spot === "picked" ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center"
                >
                  <span className="catalog-stamp rounded-sm border-4 border-seal-red bg-paper/90 px-3 py-1 font-mono text-lg font-bold tracking-[0.16em] text-seal-red uppercase shadow-hard-sm">
                    {catalog.picked}
                  </span>
                </span>
              ) : null}
            </div>
            {demo.features?.length && (wide.md || wide.lg) ? (
              <ul
                className={`mt-5 hidden flex-col gap-2 ${wide.md ? "md:flex" : "lg:flex"} ${wide.lg ? "" : "lg:hidden"}`}
              >
                {demo.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-2 font-mono text-xs leading-snug"
                  >
                    <span aria-hidden="true" className="text-ivy">
                      ✓
                    </span>
                    <Highlight text={feature} terms={terms} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-col p-5 pb-8">
            <div className="flex flex-wrap items-center gap-2 border-seal-red/40 border-b pb-3">
              <span className="eyebrow text-ink-muted">
                <Highlight text={demo.sector} terms={terms} />
              </span>
              <span className="ml-auto flex items-center gap-2">
                <ProjectMarks marks={demo.marks} />
                <LiveBadge />
              </span>
            </div>
            <h3 className="mt-3 font-mono text-xl leading-tight font-bold uppercase">
              <Link
                href={href}
                className="catalog-link outline-none after:absolute after:inset-0 after:content-['']"
              >
                <Highlight text={demo.title} terms={terms} />
              </Link>
            </h3>
            <p className="mt-2 leading-snug">
              “<Highlight text={entry.problem} terms={terms} />”
            </p>
            <p className="mt-2 line-clamp-3 text-sm text-ink-muted">
              <Highlight text={demo.summary} terms={terms} />
            </p>
            {why ? (
              <p className="mt-3 border-ink/30 border-l-2 pl-2 text-sm">
                <span className="eyebrow text-ink-muted">Also on file · </span>
                <Highlight text={why} terms={terms} />
              </p>
            ) : null}
            <ul
              aria-label="Built with"
              className="relative z-10 mt-4 flex flex-wrap gap-1.5"
            >
              {demo.tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => onTag(tag)}
                    title={`Search for ${tag}`}
                    className="catalog-tag rounded-sm border border-ink/50 bg-marble px-1.5 py-px font-mono text-[0.6875rem] text-ink-muted transition-colors hover:border-ink hover:bg-morning-haze hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
                  >
                    <Highlight text={tag} terms={terms} />
                  </button>
                </li>
              ))}
            </ul>
            <span className="eyebrow mt-auto flex items-center gap-2 pt-5 font-bold text-federal-blue">
              Open the demo
              <Icon name="arrow" size={16} className="catalog-arrow" />
            </span>
          </div>
        </div>

        <span
          aria-hidden="true"
          className="absolute bottom-2.5 left-1/2 size-3.5 -translate-x-1/2 rounded-full border-2 border-ink bg-marble"
        />
        <span aria-hidden="true" className="catalog-glare" />
      </article>
    </div>
  );
}

/** On a touch screen: whether the element sits in the middle band of the screen. */
function useCentered(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [centered, setCentered] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCentered(entry.isIntersecting),
      { rootMargin: "-38% 0px -38% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setCentered(false);
    };
  }, [ref, enabled]);
  return centered;
}
