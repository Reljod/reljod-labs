"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FONT_STACKS,
  type Mark,
  markCentre,
  rotation,
  SHEET_WIDTH,
  TEXT_ANCHOR,
  textBaseline,
} from "../domain/drawing";
import { type Cell, type Measurement, percent } from "../domain/ruler";
import type { Phase } from "./use-trace";

export type StageView = "trace" | "wipe" | "heat" | "drawing";

export const STAGE_VIEWS: { id: StageView; label: string }[] = [
  { id: "trace", label: "Trace" },
  { id: "wipe", label: "Wipe" },
  { id: "heat", label: "Heat" },
  { id: "drawing", label: "Drawing" },
];

const SPRING = {
  type: "spring",
  stiffness: 140,
  damping: 20,
  mass: 0.9,
} as const;
const INK = "#c00080";

/**
 * Releases marks onto the Sheet at a steady pace, whatever bursts the stream
 * arrives in: a few per frame, faster when many are waiting.
 */
function useReveal(total: number, instant: boolean) {
  const [shown, setShown] = useState(instant ? total : 0);
  useEffect(() => {
    if (instant || total < shown) {
      setShown(total);
      return;
    }
    if (shown >= total) return;
    const timer = window.setTimeout(() => {
      setShown((current) =>
        Math.min(
          total,
          current + Math.max(1, Math.ceil((total - current) / 10)),
        ),
      );
    }, 28);
    return () => window.clearTimeout(timer);
  }, [total, shown, instant]);
  return Math.min(shown, total);
}

type ShapeProps = { mark: Mark; ghost: Mark | undefined; still: boolean };

/** Where a mark comes from: its last Pass's self, or nowhere (it inks in). */
function geometry(mark: Mark) {
  switch (mark.kind) {
    case "box":
      return {
        x: mark.x,
        y: mark.y,
        width: mark.w,
        height: mark.h,
        rx: mark.radius,
      };
    case "ellipse":
      return {
        cx: mark.x + mark.w / 2,
        cy: mark.y + mark.h / 2,
        rx: mark.w / 2,
        ry: mark.h / 2,
      };
    case "line":
      return { x1: mark.x1, y1: mark.y1, x2: mark.x2, y2: mark.y2 };
    case "text":
      return { x: mark.x, y: textBaseline(mark), fontSize: mark.size };
  }
}

function paintOf(mark: Mark) {
  switch (mark.kind) {
    case "line":
      return { stroke: mark.color };
    case "text":
      return { fill: mark.color };
    default:
      return {
        fill: mark.fill ?? "rgba(0,0,0,0)",
        stroke: mark.stroke ?? "rgba(0,0,0,0)",
      };
  }
}

/** One mark, inked in when it is new, gliding from where it was when it is not. */
const Shape = memo(function Shape({ mark, ghost, still }: ShapeProps) {
  const target = { ...geometry(mark), ...paintOf(mark) };
  const from =
    ghost && ghost.kind === mark.kind
      ? { ...geometry(ghost), ...paintOf(ghost) }
      : null;
  const transform = rotation(mark);
  const appear = still
    ? false
    : from
      ? from
      : mark.kind === "text"
        ? { ...target, opacity: 0, clipPath: "inset(0 100% 0 0)" }
        : mark.kind === "line"
          ? { ...target, pathLength: 0 }
          : { ...target, opacity: 0 };
  const settle = from
    ? { ...target, opacity: 1, clipPath: "inset(0 0% 0 0)", pathLength: 1 }
    : { ...target, opacity: 1, clipPath: "inset(0 0% 0 0)", pathLength: 1 };
  const transition = from
    ? SPRING
    : { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] as const };

  switch (mark.kind) {
    case "box":
      return (
        <g transform={transform}>
          {!from && !still && <Construction mark={mark} />}
          <motion.rect
            initial={appear}
            animate={settle}
            transition={transition}
            strokeWidth={mark.strokeWidth}
          />
        </g>
      );
    case "ellipse":
      return (
        <g transform={transform}>
          {!from && !still && <Construction mark={mark} />}
          <motion.ellipse
            initial={appear}
            animate={settle}
            transition={transition}
            strokeWidth={mark.strokeWidth}
          />
        </g>
      );
    case "line":
      return (
        <motion.line
          initial={appear}
          animate={settle}
          transition={transition}
          strokeWidth={mark.width}
          strokeLinecap="round"
        />
      );
    case "text":
      return (
        <motion.text
          initial={appear}
          animate={settle}
          transition={from ? SPRING : { duration: 0.6, ease: "easeOut" }}
          transform={transform}
          fontFamily={FONT_STACKS[mark.family]}
          fontWeight={mark.weight}
          fontStyle={mark.italic ? "italic" : undefined}
          letterSpacing={mark.letterSpacing}
          textAnchor={TEXT_ANCHOR[mark.align]}
          xmlSpace="preserve"
        >
          {mark.text}
        </motion.text>
      );
  }
});

/** The pencil line a new box or ellipse is drawn with before it is filled. */
function Construction({ mark }: { mark: Mark }) {
  if (mark.kind !== "box" && mark.kind !== "ellipse") return null;
  const common = {
    fill: "none",
    stroke: INK,
    strokeWidth: 1.6,
    vectorEffect: "non-scaling-stroke" as const,
    initial: { pathLength: 0, opacity: 0.95 },
    animate: { pathLength: 1, opacity: 0 },
    transition: {
      pathLength: { duration: 0.4, ease: "easeInOut" as const },
      opacity: { duration: 0.5, delay: 0.45 },
    },
  };
  return mark.kind === "box" ? (
    <motion.rect
      x={mark.x}
      y={mark.y}
      width={mark.w}
      height={mark.h}
      rx={mark.radius}
      {...common}
    />
  ) : (
    <motion.ellipse
      cx={mark.x + mark.w / 2}
      cy={mark.y + mark.h / 2}
      rx={mark.w / 2}
      ry={mark.h / 2}
      {...common}
    />
  );
}

/** The artist's grid, ruled in line by line while the Draftsman reads. */
function SquaringUp({ height }: { height: number }) {
  const columns = Array.from(
    { length: SHEET_WIDTH / 100 + 1 },
    (_, index) => index * 100,
  );
  const rows = Array.from(
    { length: Math.floor(height / 100) + 1 },
    (_, index) => index * 100,
  );
  return (
    <motion.g
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.8 } }}
      stroke={INK}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
    >
      {columns.map((x, index) => (
        <motion.line
          key={`c${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={height}
          initial={{ pathLength: 0, opacity: 0.6 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, delay: index * 0.05, ease: "easeOut" }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {rows.map((y, index) => (
        <motion.line
          key={`r${y}`}
          x1={0}
          y1={y}
          x2={SHEET_WIDTH}
          y2={y}
          initial={{ pathLength: 0, opacity: 0.6 }}
          animate={{ pathLength: 1 }}
          transition={{
            duration: 0.7,
            delay: 0.25 + index * 0.05,
            ease: "easeOut",
          }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {columns.slice(1, -1).map((x, index) => (
        <motion.text
          key={`lc${x}`}
          x={x + 4}
          y={16}
          fontSize={13}
          fontFamily={FONT_STACKS.mono}
          fill={INK}
          stroke="none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 + index * 0.04 }}
        >
          {x}
        </motion.text>
      ))}
    </motion.g>
  );
}

/** A fountain-pen nib that travels to the newest mark. */
function Pen({ at, height }: { at: { x: number; y: number }; height: number }) {
  const scale = Math.max(0.9, Math.min(2.2, height / 900));
  return (
    <motion.g
      initial={{ x: at.x, y: at.y, opacity: 0 }}
      animate={{ x: at.x, y: at.y, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      style={{ pointerEvents: "none" }}
    >
      <circle
        r={18 * scale}
        fill="none"
        stroke={INK}
        strokeWidth={2}
        className="vellum-pen-ring"
      />
      <g transform={`scale(${scale}) rotate(-35)`}>
        <path
          d="M0 0 L-9 -26 Q-10 -40 0 -54 Q10 -40 9 -26 Z"
          fill="#14213d"
          stroke="#d9a84e"
          strokeWidth={2}
        />
        <line
          x1={0}
          y1={-4}
          x2={0}
          y2={-30}
          stroke="#d9a84e"
          strokeWidth={1.5}
        />
        <circle cx={0} cy={-30} r={3} fill="#d9a84e" />
      </g>
    </motion.g>
  );
}

function HeatCells({
  measurement,
  sheetHeight,
  onHover,
  reveal,
}: {
  measurement: Measurement;
  sheetHeight: number;
  onHover: (cell: Cell | null) => void;
  reveal: boolean;
}) {
  const scale = SHEET_WIDTH / measurement.width;
  return (
    <g>
      {measurement.cells.map((cell) => {
        const miss = 1 - cell.likeness;
        const heat = Math.min(1, miss * 2.2);
        return (
          <motion.rect
            key={`${cell.col}-${cell.row}`}
            x={cell.x * scale}
            y={cell.y * scale}
            width={cell.w * scale}
            height={Math.min(cell.h * scale, sheetHeight - cell.y * scale)}
            fill={heat > 0.35 ? "#b23a2b" : heat > 0.15 ? "#d9a84e" : "#2f6b3f"}
            initial={reveal ? { opacity: 0 } : false}
            animate={{ opacity: 0.12 + heat * 0.68 }}
            transition={{
              delay: reveal ? cell.row * 0.045 + cell.col * 0.012 : 0,
              duration: 0.35,
            }}
            stroke="#14213d"
            strokeOpacity={0.15}
            strokeWidth={0.5}
            onPointerEnter={() => onHover(cell)}
            onPointerLeave={() => onHover(null)}
            style={{ cursor: "crosshair" }}
          />
        );
      })}
    </g>
  );
}

export function Stage({
  src,
  sheetHeight,
  background,
  marks,
  ghost,
  phase,
  measurement,
  pass,
  view,
  live,
}: {
  src: string | null;
  sheetHeight: number;
  background: string | null;
  marks: Mark[];
  /** The last Pass's marks, by id: where a mark glides from. */
  ghost: Map<string, Mark>;
  phase: Phase;
  measurement: Measurement | null;
  pass: number;
  view: StageView;
  /** Marks are still streaming in. */
  live: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const shown = useReveal(marks.length, reduce || !live);
  const visible = useMemo(() => marks.slice(0, shown), [marks, shown]);
  const [veil, setVeil] = useState(0.55);
  const [wipe, setWipe] = useState(0.5);
  const [hover, setHover] = useState<Cell | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const latest = visible.at(-1);
  const reading = phase === "preparing" || phase === "reading";
  const measuring = phase === "measuring";
  const showHeat = view === "heat" || (measuring && measurement !== null);
  const ratio = SHEET_WIDTH / sheetHeight;

  const moveWipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = sheetRef.current?.getBoundingClientRect();
    if (!box) return;
    setWipe(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  };

  const drawingClip =
    view === "wipe" ? `inset(0 0 0 ${(wipe * 100).toFixed(2)}%)` : undefined;

  return (
    <div className="vellum-mat relative flex min-h-[22rem] w-full flex-1 items-start justify-center overflow-hidden p-4 sm:p-8">
      <div
        ref={sheetRef}
        className="relative shadow-hard-lg outline-box"
        style={{
          aspectRatio: `${SHEET_WIDTH} / ${sheetHeight}`,
          width: `min(100%, calc(68vh * ${ratio.toFixed(4)}))`,
        }}
        data-testid="vellum-sheet"
        onPointerDown={(event) => {
          if (view !== "wipe") return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          moveWipe(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) moveWipe(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        {src ? (
          // biome-ignore lint/performance/noImgElement: a visitor's own upload is a blob URL.
          <img
            src={src}
            alt="The screenshot being traced"
            className="absolute inset-0 h-full w-full select-none"
            draggable={false}
            style={{
              opacity: view === "drawing" ? 0 : 1,
              transition: "opacity 400ms",
            }}
          />
        ) : null}

        {view === "trace" && (
          <div
            className="vellum-sheet-veil absolute inset-0"
            style={{ opacity: veil }}
            aria-hidden="true"
          />
        )}

        <svg
          viewBox={`0 0 ${SHEET_WIDTH} ${sheetHeight}`}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`The Drawing: ${marks.length} marks`}
          style={{
            clipPath: drawingClip,
            opacity: view === "trace" ? 0.94 : 1,
          }}
        >
          {background && (view !== "trace" || !src) && (
            <motion.rect
              width={SHEET_WIDTH}
              height={sheetHeight}
              initial={{ opacity: 0, fill: background }}
              animate={{ opacity: 1, fill: background }}
              transition={{ duration: 0.6 }}
            />
          )}
          {live && ghost.size > 0 && (
            <g opacity={0.18} style={{ filter: "grayscale(1)" }}>
              {[...ghost.values()].map((mark) => (
                <Shape
                  key={`ghost-${mark.id}`}
                  mark={mark}
                  ghost={undefined}
                  still
                />
              ))}
            </g>
          )}
          <AnimatePresence>
            {visible.map((mark) => (
              <motion.g
                key={mark.id}
                exit={{ opacity: 0, transition: { duration: 0.4 } }}
              >
                <Shape
                  mark={mark}
                  ghost={live ? ghost.get(mark.id) : undefined}
                  still={reduce}
                />
              </motion.g>
            ))}
          </AnimatePresence>
        </svg>

        <svg
          viewBox={`0 0 ${SHEET_WIDTH} ${sheetHeight}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <AnimatePresence>
            {reading && !reduce && (
              <SquaringUp key="grid" height={sheetHeight} />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {live && latest && !reduce && (
              <Pen key="pen" at={markCentre(latest)} height={sheetHeight} />
            )}
          </AnimatePresence>
        </svg>

        {showHeat && measurement && (
          <svg
            viewBox={`0 0 ${SHEET_WIDTH} ${sheetHeight}`}
            className="absolute inset-0 h-full w-full"
            aria-label="Where the Drawing differs from the screenshot"
          >
            <HeatCells
              measurement={measurement}
              sheetHeight={sheetHeight}
              onHover={setHover}
              reveal={measuring && !reduce}
            />
          </svg>
        )}

        {reading && !reduce && (
          <div
            className="vellum-beam pointer-events-none absolute inset-x-0 top-0"
            aria-hidden="true"
          />
        )}
        {measuring && !reduce && (
          <div
            className="vellum-ruler pointer-events-none absolute inset-x-0 top-0"
            aria-hidden="true"
          />
        )}

        {view === "wipe" && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink"
            style={{ left: `${wipe * 100}%` }}
            aria-hidden="true"
          >
            <span className="outline-box absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm bg-brass font-mono text-xs font-bold shadow-hard-sm">
              ⇆
            </span>
          </div>
        )}

        <AnimatePresence>
          {measurement && pass > 0 && !live && (
            <motion.div
              key={`stamp-${pass}`}
              className="vellum-stamp pointer-events-none absolute right-3 bottom-3 sm:right-5 sm:bottom-5"
              initial={reduce ? false : { opacity: 0, scale: 2.6, rotate: -18 }}
              animate={{ opacity: 1, scale: 1, rotate: -7 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{
                type: "spring",
                stiffness: 380,
                damping: 16,
                delay: measuring ? 0.9 : 0,
              }}
              data-testid="vellum-stamp"
            >
              <span className="block text-[0.6rem] tracking-[0.2em]">
                PASS {pass}
              </span>
              <span className="block text-3xl leading-none sm:text-4xl">
                {percent(measurement.likeness)}
              </span>
              <span className="block text-[0.6rem] tracking-[0.2em]">
                LIKENESS
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {hover && showHeat && (
          <div
            className="outline-box pointer-events-none absolute z-10 w-44 rounded-sm bg-paper p-2 font-mono text-[0.65rem] shadow-hard-sm"
            style={{
              left: `${Math.min(70, (hover.x / (measurement?.width ?? 1)) * 100)}%`,
              top: `${Math.min(80, ((hover.y + hover.h) / (measurement?.height ?? 1)) * 100)}%`,
            }}
          >
            <div className="mb-1 font-bold">
              Likeness {percent(hover.likeness)}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 border border-ink"
                style={{ background: hover.original }}
              />
              screenshot {hover.original}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 border border-ink"
                style={{ background: hover.drawn }}
              />
              drawing {hover.drawn}
            </div>
            <div className="mt-1 text-ink-muted">
              colour {percent(hover.colour)} · edges {percent(hover.structure)}
            </div>
          </div>
        )}
      </div>

      {view === "trace" && src && (
        <label className="outline-box absolute top-3 left-3 flex items-center gap-2 rounded-sm bg-paper px-2 py-1 font-mono text-[0.65rem] shadow-hard-sm">
          vellum
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.01}
            value={veil}
            onChange={(event) => setVeil(Number(event.target.value))}
            aria-label="How opaque the vellum is"
            className="w-20 accent-federal-blue"
          />
        </label>
      )}
    </div>
  );
}
