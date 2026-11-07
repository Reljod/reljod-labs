"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ImageError, ImageSkeleton, useImageStatus } from "./page-image-loader";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
/** How far one pixel of wheel travel zooms; trackpad pinches send small deltas. */
const WHEEL_SENSITIVITY = 0.002;
const PINCH_SENSITIVITY = 0.01;
/** Clicks closer than this to a click-zoom belong to the same double-click. */
const DOUBLE_CLICK_MS = 500;

type View = { src: string; zoom: number; x: number; y: number };

type PageFrameProps = {
  src: string;
  alt: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

/**
 * One page in a fixed-height frame: zoom with the wheel, a trackpad pinch, a
 * click or the toolbar, drag to pan while zoomed, double-click to fit, and
 * open the full image in a new tab. Changing page resets the view.
 */
export function PageFrame({
  src,
  alt,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: PageFrameProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stored, setView] = useState<View>({ src, zoom: 1, x: 0, y: 0 });
  const view = stored.src === src ? stored : { src, zoom: 1, x: 0, y: 0 };
  const zoomed = view.zoom > MIN_ZOOM;
  const clickZoomedAt = useRef(Number.NEGATIVE_INFINITY);
  const image = useImageStatus(src);
  const loaded = image.status === "loaded";

  /** Keeps the page covering the frame: no panning past its edges. */
  function clamp(next: View): View {
    const width = frame.current?.clientWidth ?? 0;
    const height = frame.current?.clientHeight ?? 0;
    const maxX = ((next.zoom - 1) * width) / 2;
    const maxY = ((next.zoom - 1) * height) / 2;
    return {
      ...next,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  /**
   * Zooms so the page point under `anchor` (frame pixels from its centre)
   * stays put. Without an anchor, the point at the centre stays centred.
   */
  function zoomTo(zoom: number, anchor = { x: 0, y: 0 }) {
    const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const ratio = bounded / view.zoom;
    setView(
      clamp({
        src,
        zoom: bounded,
        x: anchor.x - (anchor.x - view.x) * ratio,
        y: anchor.y - (anchor.y - view.y) * ratio,
      }),
    );
  }

  /** A pointer position in frame pixels from the frame's centre. */
  function anchorOf(event: { clientX: number; clientY: number }) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  }

  function onWheel(event: WheelEvent) {
    // Browsers report a trackpad pinch as a wheel event with ctrlKey set.
    const pixels =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * 400
          : event.deltaY;
    const sensitivity = event.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, view.zoom * Math.exp(-pixels * sensitivity)),
    );
    // Scrolling down on a page that is already fitted scrolls the page itself.
    if (next === view.zoom && pixels > 0 && !event.ctrlKey) return;
    event.preventDefault();
    if (next !== view.zoom) zoomTo(next, anchorOf(event));
  }

  // React's onWheel is passive and can't stop the page scrolling, so listen
  // directly. The ref keeps the listener reading the latest view.
  const wheel = useRef(onWheel);
  wheel.current = onWheel;
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const listener = (event: WheelEvent) => wheel.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (zoomed || event.detail > 1) return;
    clickZoomedAt.current = event.timeStamp;
    zoomTo(2, anchorOf(event));
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    // The first click of this double-click already zoomed in: keep it.
    if (event.timeStamp - clickZoomedAt.current < DOUBLE_CLICK_MS) return;
    if (zoomed) zoomTo(MIN_ZOOM);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!zoomed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX - view.x, y: event.clientY - view.y };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setView(
      clamp({
        ...view,
        x: event.clientX - drag.current.x,
        y: event.clientY - drag.current.y,
      }),
    );
  }

  function onPointerUp() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <div className="outline-box relative overflow-hidden rounded-sm bg-limestone shadow-hard-lg lg:min-h-0 lg:flex-1">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the toolbar buttons are the keyboard route to zoom */}
      <div
        ref={frame}
        role="img"
        aria-label={alt}
        data-testid="page-frame"
        data-image-status={image.status}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={`relative h-72 touch-none overflow-hidden select-none sm:h-96 lg:h-full ${
          zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        }`}
      >
        <div
          className={`absolute inset-0 flex items-center justify-center p-4 sm:p-6 ${
            dragging ? "" : "transition-transform duration-150 ease-out"
          }`}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {/* biome-ignore lint/performance/noImgElement: signed Storage redirect, animated between pages */}
            <motion.img
              key={src}
              {...image.imageProps}
              alt=""
              draggable={false}
              initial={reduceMotion ? false : { opacity: 0, x: 80, rotate: 3 }}
              // Hold the slide-in until the page has loaded, so an empty frame never slides in.
              animate={
                loaded
                  ? { opacity: 1, x: 0, rotate: 0 }
                  : reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, x: 80, rotate: 3 }
              }
              exit={
                reduceMotion ? undefined : { opacity: 0, x: -80, rotate: -3 }
              }
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className={`max-h-full max-w-full rounded-[1px] border-2 border-ink bg-paper object-contain shadow-hard-md ${
                loaded ? "" : "aspect-[3/4] h-full"
              }`}
            />
          </AnimatePresence>
        </div>
        {image.status === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <div className="relative aspect-[3/4] h-full max-w-full overflow-hidden rounded-[1px] border-2 border-ink shadow-hard-md">
              <ImageSkeleton />
            </div>
          </div>
        ) : null}
        {image.status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <div className="relative aspect-[3/4] h-full max-w-full overflow-hidden rounded-[1px] border-2 border-ink shadow-hard-md">
              <ImageError onRetry={image.retry} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1 rounded-sm border-2 border-ink bg-paper p-1 shadow-hard-sm">
        <ToolButton
          label="Zoom out"
          disabled={view.zoom <= MIN_ZOOM}
          onClick={() => zoomTo(view.zoom - ZOOM_STEP)}
        >
          −
        </ToolButton>
        <output
          aria-live="polite"
          data-testid="zoom-level"
          className="min-w-12 text-center font-mono text-xs font-bold"
        >
          {Math.round(view.zoom * 100)}%
        </output>
        <ToolButton
          label="Zoom in"
          disabled={view.zoom >= MAX_ZOOM}
          onClick={() => zoomTo(view.zoom + ZOOM_STEP)}
        >
          +
        </ToolButton>
        <ToolButton
          label="Fit page"
          disabled={!zoomed}
          onClick={() => zoomTo(MIN_ZOOM)}
        >
          ⤢
        </ToolButton>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open page in a new tab"
          title="Open page in a new tab"
          className="grid size-8 place-items-center rounded-sm font-mono font-bold hover:bg-morning-haze focus-visible:outline-2 focus-visible:outline-federal-blue"
        >
          ↗
        </a>
      </div>

      <PreviewArrow side="left" disabled={!hasPrevious} onClick={onPrevious} />
      <PreviewArrow side="right" disabled={!hasNext} onClick={onNext} />
    </div>
  );
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-sm font-mono font-bold hover:bg-morning-haze focus-visible:outline-2 focus-visible:outline-federal-blue disabled:pointer-events-none disabled:opacity-30"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

function PreviewArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous page" : "Next page"}
      disabled={disabled}
      onClick={onClick}
      className={`outline-box absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-paper font-mono font-bold shadow-hard-sm transition-colors hover:bg-morning-haze focus-visible:outline-2 focus-visible:outline-federal-blue disabled:pointer-events-none disabled:opacity-0 ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      {side === "left" ? "◂" : "▸"}
    </button>
  );
}
