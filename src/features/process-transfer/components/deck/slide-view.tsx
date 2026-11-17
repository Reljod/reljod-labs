"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Deck,
  type DeckTheme,
  type ImageElement,
  type ShapeElement,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type TextElement,
} from "../../domain/deck";
import {
  type EntranceTiming,
  entranceSchedule,
  placeholderText,
  RISE_OFFSET,
} from "../../domain/deck-layout";
import { bulletIndent, plainText, ptToPx } from "../../domain/deck-text";
import { type FrameUrls, frameKey } from "../../domain/frames";

/*
 * The browser preview of a Deck. Every element sits at its Deck geometry on
 * a 1280 x 720 canvas scaled to the box: positions are percentages of the
 * slide, and lengths are container-query units of its width, so type,
 * padding and line pitch scale with it exactly as the PPTX lays them out.
 */

/** Web stand-ins with the same metrics as the PowerPoint fonts, for machines without them. */
const FALLBACKS: Record<TextElement["font"], string> = {
  heading: 'Gelasio, "Times New Roman", serif',
  body: '"Liberation Sans", Helvetica, Arial, sans-serif',
  mono: 'Menlo, "DejaVu Sans Mono", "Courier New", monospace',
};

const cqw = (px: number) => `${(px / SLIDE_W) * 100}cqw`;
const pctX = (px: number) => `${(px / SLIDE_W) * 100}%`;
const pctY = (px: number) => `${(px / SLIDE_H) * 100}%`;

const KEYFRAMES = `
@keyframes ptx-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ptx-rise { from { opacity: 0; transform: translateY(${cqw(RISE_OFFSET * SLIDE_H)}) } to { opacity: 1; transform: none } }
@keyframes ptx-wipe { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes ptx-zoom { from { opacity: 0; transform: scale(0) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { [data-ptx-entrance] { animation: none !important } }
`;

function fontFamily(theme: DeckTheme, font: TextElement["font"]): string {
  return `"${theme.fonts[font]}", ${FALLBACKS[font]}`;
}

function box(element: SlideElement): CSSProperties {
  return {
    position: "absolute",
    left: pctX(element.x),
    top: pctY(element.y),
    width: pctX(element.w),
    height: pctY(element.h),
    boxSizing: "border-box",
  };
}

function TextView({
  element,
  theme,
}: {
  element: TextElement;
  theme: DeckTheme;
}) {
  const indent = bulletIndent(element.fontSize);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent:
          element.valign === "middle"
            ? "center"
            : element.valign === "bottom"
              ? "flex-end"
              : "flex-start",
        padding: cqw(element.padding),
        background: element.fill ?? "transparent",
        color: element.color,
        fontFamily: fontFamily(theme, element.font),
        fontSize: cqw(ptToPx(element.fontSize)),
        lineHeight: element.lineHeight,
        textAlign: element.align,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {element.paragraphs.map((paragraph, index) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no identity beyond their place
          key={index}
          style={{
            margin: 0,
            marginTop:
              index > 0 && paragraph.gapBefore ? cqw(paragraph.gapBefore) : 0,
            paddingLeft: paragraph.bullet ? cqw(indent) : 0,
          }}
        >
          {paragraph.bullet ? (
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: cqw(indent),
                marginLeft: `-${cqw(indent)}`,
                fontSize: "0.6em",
                fontFamily: "Arial, sans-serif",
                color: theme.colors.accent,
                verticalAlign: "0.15em",
              }}
            >
              ■
            </span>
          ) : null}
          {paragraph.runs.map((run, runIndex) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity beyond their place
              key={runIndex}
              style={{
                fontWeight: run.bold ? 700 : 400,
                color: run.color ?? undefined,
              }}
            >
              {run.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function ShapeView({ element }: { element: ShapeElement }) {
  const stroke =
    element.stroke && element.strokeWidth > 0
      ? `${cqw(element.strokeWidth)} solid ${element.stroke}`
      : undefined;
  if (element.shape === "line") {
    return <div style={{ width: "100%", height: 0, borderTop: stroke }} />;
  }
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: element.fill ?? "transparent",
        border: stroke,
        boxSizing: "border-box",
        borderRadius:
          element.shape === "ellipse"
            ? "50%"
            : element.shape === "roundRect"
              ? cqw(Math.min(element.w, element.h) / 6)
              : 0,
        clipPath:
          element.shape === "chevron"
            ? "polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%, 25% 50%)"
            : undefined,
      }}
    />
  );
}

function ImageView({
  element,
  theme,
  frames,
}: {
  element: ImageElement;
  theme: DeckTheme;
  frames?: FrameUrls;
}) {
  const url = frames?.[frameKey(element.frameAt)];
  const hairline = `max(1px, ${cqw(1)})`;
  if (url) {
    return (
      // biome-ignore lint/performance/noImgElement: frames are blob URLs captured in the browser, not assets next/image can optimise
      <img
        src={url}
        alt={element.alt}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          border: `${hairline} solid ${theme.colors.ink}`,
          boxSizing: "border-box",
        }}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={element.alt}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: theme.colors.surface,
        border: `${hairline} dashed ${theme.colors.muted}`,
        color: theme.colors.muted,
        fontFamily: fontFamily(theme, "body"),
        fontSize: cqw(ptToPx(13)),
        boxSizing: "border-box",
      }}
    >
      {placeholderText(element)}
    </div>
  );
}

export type SlideViewProps = {
  slide: Slide;
  theme: DeckTheme;
  frames?: FrameUrls;
  /** How many entrance orders have arrived; undefined shows everything, still. */
  revealed?: number;
  className?: string;
};

/** One slide, scaled to the width of its box, with its entrances played up to `revealed`. */
export function SlideView({
  slide,
  theme,
  frames,
  revealed,
  className,
}: SlideViewProps) {
  const timings = useMemo(() => {
    const map = new Map<string, EntranceTiming>();
    for (const timing of entranceSchedule(slide))
      map.set(timing.elementId, timing);
    return map;
  }, [slide]);
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${SLIDE_W} / ${SLIDE_H}`,
        overflow: "hidden",
        containerType: "inline-size",
        background: slide.background,
      }}
    >
      {revealed !== undefined ? <style>{KEYFRAMES}</style> : null}
      {slide.elements.map((element) => {
        const animation = element.animation;
        const timing = timings.get(element.id);
        const hidden =
          revealed !== undefined &&
          animation !== null &&
          animation.order > revealed;
        const playing =
          revealed !== undefined && animation !== null && !hidden && timing;
        const style: CSSProperties = {
          ...box(element),
          visibility: hidden ? "hidden" : undefined,
          animation: playing
            ? `ptx-${animation.effect} ${animation.durationMs}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${timing.startMs}ms both`
            : undefined,
        };
        return (
          <div
            key={element.id}
            style={style}
            data-ptx-entrance={playing ? "" : undefined}
            aria-hidden={
              element.role === "decoration" || hidden ? true : undefined
            }
          >
            {element.type === "text" ? (
              <TextView element={element} theme={theme} />
            ) : element.type === "shape" ? (
              <ShapeView element={element} />
            ) : (
              <ImageView element={element} theme={theme} frames={frames} />
            )}
          </div>
        );
      })}
    </div>
  );
}

type Group = { group: number; last: number; endMs: number };

/** The click groups of a slide: what arrives with the slide (group 0) and on each click after. */
function groupsOf(slide: Slide): Group[] {
  const groups = new Map<number, Group>();
  for (const timing of entranceSchedule(slide)) {
    const known = groups.get(timing.group);
    groups.set(timing.group, {
      group: timing.group,
      last: Math.max(known?.last ?? 0, timing.order),
      endMs: Math.max(known?.endMs ?? 0, timing.endMs),
    });
  }
  return [...groups.values()].sort((a, b) => a.group - b.group);
}

function arrival(slide: Slide): number {
  return groupsOf(slide).find((item) => item.group === 0)?.last ?? 0;
}

function lastOrder(slide: Slide): number {
  return groupsOf(slide).reduce((max, item) => Math.max(max, item.last), 0);
}

function slideTitle(slide: Slide): string {
  const title = slide.elements.find((element) => element.role === "title");
  return title && title.type === "text" ? plainText(title) : slide.planId;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** How long Play lingers on a fully built slide before moving on. */
const DWELL_MS = 2200;

export type DeckPlayerProps = {
  deck: Deck;
  frames?: FrameUrls;
  initialSlide?: number;
  onSlideChange?(index: number): void;
};

/** The Deck as a presenter sees it: entrances on click, the slide transition, notes and a filmstrip. */
export function DeckPlayer({
  deck,
  frames,
  initialSlide = 0,
  onSlideChange,
}: DeckPlayerProps) {
  const count = deck.slides.length;
  const clamp = useCallback(
    (value: number) => Math.min(Math.max(0, value), Math.max(0, count - 1)),
    [count],
  );
  const [index, setIndex] = useState(() => clamp(initialSlide));
  const [revealed, setRevealed] = useState(() =>
    deck.slides[clamp(initialSlide)]
      ? arrival(deck.slides[clamp(initialSlide)])
      : 0,
  );
  const [previous, setPrevious] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const reduced = usePrefersReducedMotion();
  const stage = useRef<HTMLElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const slide = deck.slides[index];

  const go = useCallback(
    (next: number, built = false) => {
      const target = clamp(next);
      if (target === index) return;
      const nextSlide = deck.slides[target];
      setPrevious(index);
      setIndex(target);
      setRevealed(built ? lastOrder(nextSlide) : arrival(nextSlide));
      onSlideChange?.(target);
    },
    [clamp, deck.slides, index, onSlideChange],
  );

  const advance = useCallback(() => {
    if (!slide) return;
    const next = groupsOf(slide).find((item) => item.last > revealed);
    if (next) setRevealed(next.last);
    else if (index < count - 1) go(index + 1);
    else setPlaying(false);
  }, [count, go, index, revealed, slide]);

  const back = useCallback(() => {
    if (index > 0) go(index - 1, true);
  }, [go, index]);

  // The slide transition: the new slide comes in over the one it replaces.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per slide change
  useEffect(() => {
    const element = current.current;
    if (!element || previous === null || !slide) return;
    const { type, durationMs } = slide.transition;
    if (reduced || type === "none" || durationMs <= 0) {
      setPrevious(null);
      return;
    }
    const frames: Keyframe[] =
      type === "push"
        ? [{ transform: "translateX(100%)" }, { transform: "none" }]
        : type === "wipe"
          ? [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }]
          : [{ opacity: 0 }, { opacity: 1 }];
    const animation = element.animate(frames, {
      duration: durationMs,
      easing: "ease-out",
    });
    animation.onfinish = () => setPrevious(null);
    return () => animation.cancel();
  }, [index]);

  // Play moves on once the current entrances have finished and the slide has been seen.
  useEffect(() => {
    if (!playing || !slide) return;
    const group = groupsOf(slide).find((item) => item.last === revealed);
    const wait =
      (group?.endMs ?? 0) +
      (groupsOf(slide).some((item) => item.last > revealed) ? 600 : DWELL_MS);
    const timer = window.setTimeout(advance, wait);
    return () => window.clearTimeout(timer);
  }, [advance, playing, revealed, slide]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: advance,
      ArrowDown: advance,
      PageDown: advance,
      " ": advance,
      Enter: advance,
      ArrowLeft: back,
      ArrowUp: back,
      PageUp: back,
      Home: () => go(0),
      End: () => go(count - 1, true),
    };
    const action = keys[event.key];
    if (!action || event.target !== stage.current) return;
    event.preventDefault();
    action();
  };

  if (!slide) {
    return (
      <p className="rounded-sm border-2 border-ink bg-paper p-4 text-sm text-ink-muted">
        The deck has no slides.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <section
        ref={stage}
        aria-roledescription="slide deck"
        aria-label={`${deck.title}. Space or the right arrow plays the next entrance; the left arrow goes back.`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage takes the presenter's keys when focused, like a slide show
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={advance}
        className="relative cursor-pointer overflow-hidden rounded-sm border-2 border-ink bg-ink shadow-hard-md focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-federal-blue"
      >
        {previous !== null && deck.slides[previous] ? (
          <div className="absolute inset-0" aria-hidden>
            <SlideView
              slide={deck.slides[previous]}
              theme={deck.theme}
              frames={frames}
            />
          </div>
        ) : null}
        <div ref={current} key={slide.id} className="relative">
          <SlideView
            slide={slide}
            theme={deck.theme}
            frames={frames}
            revealed={revealed}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={back}
          disabled={index === 0}
          aria-label="Previous slide"
          className="outline-box press eyebrow rounded-sm bg-paper px-3 py-1.5 text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={advance}
          disabled={index === count - 1 && revealed >= lastOrder(slide)}
          aria-label="Next entrance or slide"
          className="outline-box press eyebrow rounded-sm bg-paper px-3 py-1.5 text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          Next →
        </button>
        <button
          type="button"
          onClick={() => {
            if (!playing && index === count - 1 && revealed >= lastOrder(slide))
              go(0);
            setPlaying((value) => !value);
          }}
          aria-pressed={playing}
          aria-label={playing ? "Pause" : "Play the deck"}
          className="outline-box press eyebrow rounded-sm bg-ink px-3 py-1.5 text-paper"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="eyebrow ml-auto text-ink-muted" aria-live="polite">
          Slide {index + 1} of {count}
        </span>
      </div>

      <section
        aria-label="Speaker notes"
        className="rounded-sm border-2 border-ink bg-paper p-3"
      >
        <p className="eyebrow text-ink-muted">Speaker notes</p>
        <p className="mt-1 text-sm text-ink">
          {slide.notes || "No notes for this slide."}
        </p>
      </section>

      <ol aria-label="Slides" className="flex gap-2 overflow-x-auto pb-2">
        {deck.slides.map((item, at) => (
          <li key={item.id} className="w-36 shrink-0">
            <button
              type="button"
              onClick={() => go(at, true)}
              aria-label={`Slide ${at + 1}: ${slideTitle(item)}`}
              aria-current={at === index ? "true" : undefined}
              className={`block w-full overflow-hidden rounded-sm border-2 text-left transition-[border-color,box-shadow] ${
                at === index
                  ? "border-federal-blue shadow-hard-sm"
                  : "border-ink/30 hover:border-ink"
              }`}
            >
              <SlideView slide={item} theme={deck.theme} frames={frames} />
            </button>
            <p className="eyebrow mt-1 text-ink-muted">{at + 1}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
