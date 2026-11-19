"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { frameSrc } from "../domain/api";
import type { FrameEvent, RunSummary } from "../domain/contract";
import { GEOMETRY, SCREEN_TITLES } from "../legacy/types";
import { fitScale } from "./scrub";
import { cx } from "./ui";

type RunRef = Pick<RunSummary, "id" | "taskId" | "replay">;

/** How wide an element is on the page, kept up to date. 0 until measured. */
export function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The terminal's case, in the Colonnade language: a limestone bezel with the
 * ink outline and a hard shadow, a name plate, and the dark glass inside.
 * `glass` is laid over a box with the Screen's aspect ratio.
 */
export function Bezel({
  plate,
  lamp,
  lampTone = "idle",
  focused = false,
  glass,
  over,
  children,
}: {
  /** The name plate, top left. */
  plate: string;
  /** The status lamp's words, top right. */
  lamp: string;
  lampTone?: "idle" | "live" | "stopped";
  /** The terminal has the keyboard (hand mode): the bezel shows the ring. */
  focused?: boolean;
  glass: ReactNode;
  /** Laid over the glass on wide screens, under it on a phone. */
  over?: ReactNode;
  /** The chin under the glass. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "outline-box relative rounded-sm bg-limestone p-2 shadow-hard-lg sm:p-3",
        focused && "outline-3 outline-offset-4 outline-federal-blue",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[0.62rem] font-bold tracking-[0.12em] uppercase">
        <span className="truncate">{plate}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cx(
              "size-2 border border-ink",
              lampTone === "live" && "bg-ivy motion-safe:animate-pulse",
              lampTone === "stopped" && "bg-seal-red",
              lampTone === "idle" && "bg-brass",
            )}
          />
          {lamp}
        </span>
      </div>
      <div className="relative">
        <div
          className="op-glass relative overflow-hidden rounded-sm border-2 border-ink"
          style={{ aspectRatio: `${GEOMETRY.width} / ${GEOMETRY.height}` }}
        >
          {glass}
        </div>
        {over}
      </div>
      {children}
    </div>
  );
}

/** The Frame whose picture has loaded, so the old one stays up until the new one is ready. */
function useLoadedFrame(run: RunRef, n: number | null) {
  const [shown, setShown] = useState<{ n: number; ok: boolean } | null>(null);
  const src = n === null ? null : frameSrc(run, n);
  useEffect(() => {
    if (src === null || n === null) {
      setShown(null);
      return;
    }
    let current = true;
    const image = new Image();
    image.onload = () => current && setShown({ n, ok: true });
    image.onerror = () => current && setShown({ n, ok: false });
    image.src = src;
    return () => {
      current = false;
    };
  }, [src, n]);
  return shown;
}

function Pointer({ x, y, shown }: { x: number; y: number; shown: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden="true"
      className="absolute top-0 left-0"
      initial={false}
      animate={{ x, y, opacity: shown ? 1 : 0 }}
      transition={
        reduce
          ? { duration: 0 }
          : { type: "spring", stiffness: 240, damping: 26, mass: 0.7 }
      }
    >
      <svg width="20" height="24" viewBox="0 0 20 24" className="block">
        <title>Mouse pointer</title>
        <path
          d="M1.5 1.5v17l4.6-4.3 3.1 7.3 3-1.3-3.1-7.2h6.4z"
          fill="#ffffff"
          stroke="#14213d"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  );
}

/** Typed text, one character at a time. Under reduced motion it is all there at once. */
function Typed({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(
      () =>
        setCount((value) => {
          if (value >= text.length) clearInterval(timer);
          return Math.min(text.length, value + 1);
        }),
      TYPE_MS,
    );
    return () => clearInterval(timer);
  }, [text, reduce]);
  const typed = reduce ? text : text.slice(0, count);
  return (
    <span className="whitespace-pre">
      {typed}
      <span aria-hidden="true" className="bg-paper text-ink">
        {" "}
      </span>
    </span>
  );
}

const TYPE_MS = 26;
const CAP =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border-2 border-ink bg-paper px-1.5 font-mono text-[0.68rem] font-bold text-ink shadow-hard-sm";

/** What the Action pressed, popping in at the bottom of the glass. */
function KeyChips({ frame }: { frame: FrameEvent }) {
  const action = frame.action;
  if (!action) return null;
  const hold =
    action.type === "type" ? action.text.length * TYPE_MS + 1700 : 1900;
  return (
    <div
      key={frame.n}
      aria-hidden="true"
      className="op-chip pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-center gap-1.5"
      style={{ "--hold": `${hold}ms` } as React.CSSProperties}
    >
      {action.type === "type" ? (
        <span className="max-w-full overflow-hidden rounded-sm border-2 border-ink bg-ink px-2 py-1 font-mono text-xs font-bold text-paper shadow-hard-sm">
          <Typed text={action.text} />
        </span>
      ) : action.type === "key" ? (
        action.keys.map((key, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one Action may press the same key twice
          <kbd key={index} className={CAP}>
            {key}
          </kbd>
        ))
      ) : (
        <span className={CAP}>{frame.label}</span>
      )}
    </div>
  );
}

/**
 * The Screen: a Frame's picture in the bezel, with the mouse pointer gliding
 * to where the Action left it, a ripple where it clicked, and the keys it
 * pressed. Positions are Screen pixels scaled to the element.
 */
export function Screen({
  run,
  frames,
  index,
  plate,
  lamp,
  lampTone,
  dimmed,
  empty,
  over,
  children,
}: {
  run: RunRef;
  frames: FrameEvent[];
  index: number;
  plate: string;
  lamp: string;
  lampTone: "idle" | "live" | "stopped";
  /** The Run is paused: the glass steps back for the Approval card. */
  dimmed: boolean;
  /** What the glass says while there is no Frame. */
  empty: ReactNode;
  over?: ReactNode;
  children?: ReactNode;
}) {
  const glass = useRef<HTMLDivElement>(null);
  const scale = fitScale(useWidth(glass), GEOMETRY.width);
  const wanted = frames[index] ?? null;
  const loaded = useLoadedFrame(run, wanted?.n ?? null);
  // Until the wanted picture is in, the last one that loaded stays up.
  const frame =
    frames.find((item) => item.n === loaded?.n) ?? (loaded ? wanted : null);
  const next = frames[index + 1];

  // The next Frame's picture is fetched ahead, so stepping never flashes.
  useEffect(() => {
    if (!next) return;
    const image = new Image();
    image.src = frameSrc(run, next.n);
  }, [run, next]);

  const click = frame?.action?.type === "click" ? frame.action : null;
  return (
    <Bezel
      plate={plate}
      lamp={lamp}
      lampTone={lampTone}
      over={over}
      glass={
        <div ref={glass} className="absolute inset-0">
          {frame && loaded?.ok ? (
            // biome-ignore lint/performance/noImgElement: a Frame is a fixed 1024x640 PNG from a gated route or a static file
            <img
              src={frameSrc(run, frame.n)}
              width={GEOMETRY.width}
              height={GEOMETRY.height}
              alt={`HARBOURMASTER Screen ${frame.screen}, ${SCREEN_TITLES[frame.screen]}, after ${frame.label}`}
              draggable={false}
              className={cx(
                "block size-full transition-opacity duration-200",
                dimmed && "opacity-45",
              )}
            />
          ) : (
            <div className="grid size-full place-items-center p-4 text-center font-mono text-xs text-[#7dffb0]/80 sm:text-sm">
              {frame && loaded && !loaded.ok
                ? `The picture of Frame ${frame.n} is not available.`
                : empty}
            </div>
          )}
          {frame && scale > 0 ? (
            <div className="pointer-events-none absolute inset-0">
              {click ? (
                <span
                  key={frame.n}
                  aria-hidden="true"
                  className="op-ripple absolute size-12 rounded-full border-2 border-brass"
                  style={{ left: click.x * scale, top: click.y * scale }}
                />
              ) : null}
              <Pointer
                x={(frame.pointer?.x ?? 0) * scale}
                y={(frame.pointer?.y ?? 0) * scale}
                shown={frame.pointer !== null}
              />
              <KeyChips frame={frame} />
            </div>
          ) : null}
        </div>
      }
    >
      {children}
    </Bezel>
  );
}
