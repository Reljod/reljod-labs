"use client";

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { type PointerEvent, useRef, useState } from "react";
import "./landing.css";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import {
  type DeskLine,
  type DeskNote,
  desk,
  deskPages,
} from "@/content/landing";
import { RevealWords } from "./reveal";
import { useTimers } from "./use-timers";

/*
 * The stage is 100cqw wide and 80cqw tall. Everything on it is placed in
 * those units, so the strings between the page and the notes line up at any
 * width.
 */
const DESK_TOP = 62;
const PAPER = { left: 4, top: 4, width: 44, height: DESK_TOP - 4 };
const ROW_TOP = 16;
const ROW_STEP = 9;
const ROW_HEIGHT = 7.5;
const BOARD = { left: 54, top: 10, width: 44, height: 51 };
const NOTE = { left: 58, width: 37, height: 13, tops: [14, 29, 44] };
/** How long the AI takes to read one page, in ms. Short on purpose. */
const SCAN_MS = 1600;

type Phase = "ready" | "reading" | "read";
type Noted = { row: number; note: DeskNote };

const rowTop = (row: number) => ROW_TOP + row * ROW_STEP;

/** The opening scene: what the site is in two lines, and a page the AI reads. */
export function DeskScene() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const timers = useTimers();

  const [pageIndex, setPageIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [revealed, setRevealed] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);

  const page = deskPages[pageIndex];
  const noted: Noted[] = page.lines.flatMap((line, row) =>
    line.note ? [{ row, note: line.note }] : [],
  );
  const shown = noted.slice(0, revealed);
  const flags = noted.filter((item) => item.note.kind === "flag").length;

  // Scrolling away strikes the set: the wall lifts, the desk sinks.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  // The desk leans toward the pointer, a little, on a mouse.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const leanX = useSpring(pointerX, { stiffness: 70, damping: 18 });
  const leanY = useSpring(pointerY, { stiffness: 70, damping: 18 });
  const backX = useTransform(leanX, (v) => v * -10);
  const frontX = useTransform(leanX, (v) => v * 6);
  const backY = useTransform(
    [scrollYProgress, leanY],
    ([scroll, lean]: number[]) => scroll * -110 + lean * -6,
  );
  const frontY = useTransform(
    [scrollYProgress, leanY],
    ([scroll, lean]: number[]) => scroll * 80 + lean * 4,
  );

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (reduce || event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - box.left) / box.width) * 2 - 1);
    pointerY.set(((event.clientY - box.top) / box.height) * 2 - 1);
  }

  // Each note is pinned the moment the scan line passes its row.
  function read() {
    if (reduce) {
      setRevealed(noted.length);
      setPhase("read");
      return;
    }
    setPhase("reading");
    noted.forEach((item, index) => {
      const passed =
        (rowTop(item.row) + ROW_HEIGHT / 2 - PAPER.top) / PAPER.height;
      timers.later(() => setRevealed(index + 1), passed * SCAN_MS);
    });
    timers.later(() => setPhase("read"), SCAN_MS + 80);
  }

  function nextPage() {
    timers.clearAll();
    setPageIndex((index) => (index + 1) % deskPages.length);
    setPhase("ready");
    setRevealed(0);
    setFocus(null);
  }

  function onPaper() {
    if (phase === "ready") read();
    else if (phase === "read") nextPage();
  }

  return (
    <section
      id="top"
      ref={sectionRef}
      aria-labelledby="hero-title"
      onPointerMove={onPointerMove}
      className="overflow-hidden bg-marble bg-[linear-gradient(rgb(20_33_61/0.05)_2px,transparent_2px),linear-gradient(90deg,rgb(20_33_61/0.05)_2px,transparent_2px)] bg-size-[40px_40px]"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1fr_1.15fr] lg:py-16">
        <div>
          <motion.p
            className="eyebrow mb-6 text-ink-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {desk.eyebrow}
          </motion.p>
          <h1
            id="hero-title"
            className="font-mono text-4xl leading-[1.05] font-bold tracking-[-0.02em] uppercase sm:text-5xl lg:text-6xl"
          >
            <RevealWords text={desk.lines[0]} onMount className="block" />
            <RevealWords
              text={desk.lines[1]}
              onMount
              delay={0.3}
              className="block text-federal-blue"
            />
          </h1>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.7 }}
          >
            <p className="mt-6 max-w-xl text-lg leading-relaxed sm:text-xl">
              {desk.intro}
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <ButtonLink href="#demos">
                See the projects
                <Icon name="arrow" size={18} />
              </ButtonLink>
              <ButtonLink href="#who" variant="secondary">
                Who's Reljod?
              </ButtonLink>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96, rotate: -1 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="outline-box @container relative aspect-[5/4] overflow-hidden bg-marble shadow-hard-lg">
            <motion.div
              className="absolute inset-0"
              style={reduce ? undefined : { x: backX, y: backY }}
            >
              <BackWall />
            </motion.div>
            <motion.div
              className="absolute inset-0"
              style={reduce ? undefined : { x: frontX, y: frontY }}
            >
              <FrontDesk />
              <Board empty={revealed === 0} />

              <AnimatePresence mode="wait" initial={false}>
                <motion.button
                  key={pageIndex}
                  type="button"
                  onClick={onPaper}
                  disabled={phase === "reading"}
                  aria-label={
                    phase === "read"
                      ? "Next page"
                      : `Let the AI read the ${page.title}`
                  }
                  initial={{ opacity: 0, y: "-3cqw", rotate: 2 }}
                  animate={{ opacity: 1, y: "0cqw", rotate: 0 }}
                  exit={{ opacity: 0, x: "-8cqw", rotate: -4 }}
                  transition={{ duration: reduce ? 0 : 0.22 }}
                  className="group absolute cursor-pointer border-2 border-ink bg-paper text-left shadow-hard-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-federal-blue disabled:cursor-progress"
                  style={{
                    left: `${PAPER.left}cqw`,
                    top: `${PAPER.top}cqw`,
                    width: `${PAPER.width}cqw`,
                    height: `${PAPER.height}cqw`,
                  }}
                >
                  <Page
                    title={page.title}
                    lines={page.lines}
                    revealedRows={shown.map((item) => item.row)}
                    focusRow={focus === null ? null : noted[focus]?.row}
                  />
                  {phase === "reading" ? (
                    <motion.span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 h-[5cqw] border-federal-blue border-b-2 bg-linear-to-b from-transparent to-clear-sky/50"
                      initial={{ top: "-5cqw" }}
                      animate={{ top: `${PAPER.height - 5}cqw` }}
                      transition={{ duration: SCAN_MS / 1000, ease: "linear" }}
                    />
                  ) : null}
                  {phase === "ready" && !reduce ? (
                    <span
                      aria-hidden="true"
                      className="landing-nudge absolute right-[2cqw] bottom-[1.6cqw] border-2 border-federal-blue bg-paper px-[1cqw] font-mono text-[2.4cqw] font-bold text-federal-blue"
                    >
                      tap to read
                    </span>
                  ) : null}
                </motion.button>
              </AnimatePresence>

              <Strings
                key={`strings-${pageIndex}`}
                shown={shown}
                focus={focus}
                reduce={Boolean(reduce)}
              />

              <AnimatePresence>
                {shown.map((item, index) => (
                  <motion.button
                    key={`${pageIndex}-${item.row}`}
                    type="button"
                    aria-pressed={focus === index}
                    onClick={() =>
                      setFocus((current) => (current === index ? null : index))
                    }
                    initial={
                      reduce
                        ? false
                        : { opacity: 0, scale: 0.5, x: "-12cqw", rotate: -10 }
                    }
                    animate={{
                      opacity: 1,
                      scale: 1,
                      x: "0cqw",
                      rotate: index % 2 === 0 ? -1.5 : 1.5,
                    }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                    className={`absolute flex cursor-pointer items-center border-2 border-ink px-[1.6cqw] text-left text-[3cqw] leading-[1.2] font-semibold shadow-hard-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue ${item.note.kind === "flag" ? "bg-[#f6dcd6]" : "bg-paper"} ${focus === index ? "ring-[0.6cqw] ring-brass" : ""}`}
                    style={{
                      left: `${NOTE.left}cqw`,
                      top: `${NOTE.tops[index]}cqw`,
                      width: `${NOTE.width}cqw`,
                      height: `${NOTE.height}cqw`,
                    }}
                  >
                    <span className="sr-only">
                      {item.note.kind === "flag" ? "Flag: " : "Found: "}
                    </span>
                    {item.note.text}
                  </motion.button>
                ))}
              </AnimatePresence>
            </motion.div>
          </div>

          <div className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted" aria-live="polite">
              {phase === "ready"
                ? desk.hint
                : phase === "reading"
                  ? "Reading…"
                  : `Read in under two seconds: ${noted.length - flags} ${noted.length - flags === 1 ? "fact" : "facts"}, ${flags} for a person to check. ${desk.readHint}`}
            </p>
            {phase === "read" ? (
              <button
                type="button"
                onClick={nextPage}
                className="eyebrow outline-box press flex items-center gap-2 rounded-sm bg-paper px-3 py-2 font-bold"
              >
                Next page <Icon name="arrow" size={14} />
              </button>
            ) : null}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** The document on the clipboard; rows the AI noted light up as it reads them. */
function Page({
  title,
  lines,
  revealedRows,
  focusRow,
}: {
  title: string;
  lines: DeskLine[];
  revealedRows: number[];
  focusRow: number | null | undefined;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute left-1/2 -top-[1.6cqw] h-[3.4cqw] w-[14cqw] -translate-x-1/2 rounded-sm border-2 border-ink bg-[#9aa3b2]"
      />
      <span className="absolute inset-x-[3cqw] top-[4.4cqw] flex items-baseline justify-between gap-[1cqw] border-ink border-b-2 pb-[1cqw]">
        <span className="font-mono text-[3cqw] leading-none font-bold uppercase">
          {title}
        </span>
        <span className="font-mono text-[1.8cqw] font-bold tracking-[0.12em] text-seal-red">
          SPECIMEN
        </span>
      </span>
      {lines.map((line, row) => {
        const lit = revealedRows.includes(row);
        const flag = line.note?.kind === "flag";
        return (
          <span
            key={line.label}
            className={`absolute inset-x-[2cqw] flex flex-col justify-center px-[1cqw] transition-colors duration-300 ${lit ? (flag ? "bg-seal-red/15" : "bg-brass/35") : ""} ${focusRow === row ? "outline-[0.5cqw] outline-brass outline-solid" : ""}`}
            style={{
              top: `${rowTop(row) - PAPER.top}cqw`,
              height: `${ROW_HEIGHT}cqw`,
            }}
          >
            <span className="font-mono text-[2.1cqw] leading-tight tracking-[0.08em] text-ink-muted uppercase">
              {line.label}
            </span>
            {line.value ? (
              <span className="truncate text-[3.2cqw] leading-tight font-bold">
                {line.value}
              </span>
            ) : (
              <span className="mt-[0.6cqw] block h-[2.6cqw] w-[20cqw] border-seal-red/70 border-b-2 border-dashed">
                <span className="sr-only">left blank</span>
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

/** The cork board the notes are pinned to. */
function Board({ empty }: { empty: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="absolute flex items-center justify-center border-2 border-ink bg-[#d2a679] bg-[radial-gradient(rgb(107_66_38/0.3)_0.25cqw,transparent_0.35cqw)] bg-size-[2.6cqw_2.6cqw] shadow-[inset_0_0_0_0.9cqw_#6b4226]"
      style={{
        left: `${BOARD.left}cqw`,
        top: `${BOARD.top}cqw`,
        width: `${BOARD.width}cqw`,
        height: `${BOARD.height}cqw`,
      }}
    >
      {empty ? (
        <span className="bg-paper/70 px-[1.4cqw] font-mono text-[2.4cqw] font-bold text-oak">
          the AI's notes go here
        </span>
      ) : null}
    </div>
  );
}

/** Red string from each note back to the line it came from, as on a case board. */
function Strings({
  shown,
  focus,
  reduce,
}: {
  shown: Noted[];
  focus: number | null;
  reduce: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 80"
      className="pointer-events-none absolute inset-0 size-full"
      fill="none"
    >
      {shown.map((item, index) => {
        const x1 = PAPER.left + PAPER.width - 2;
        const y1 = rowTop(item.row) + ROW_HEIGHT / 2;
        const x2 = NOTE.left + 1.6;
        const y2 = NOTE.tops[index] + 2;
        const sag = Math.max(y1, y2) + 3;
        const dim = focus !== null && focus !== index;
        return (
          <g key={item.row} opacity={dim ? 0.25 : 1}>
            <motion.path
              d={`M${x1} ${y1} Q${(x1 + x2) / 2} ${sag} ${x2} ${y2}`}
              stroke="#b23a2b"
              strokeWidth={focus === index ? 0.9 : 0.55}
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            />
            <circle cx={x1} cy={y1} r="0.9" fill="#b23a2b" />
            <circle
              cx={x2}
              cy={y2}
              r="1.2"
              fill="#b23a2b"
              stroke="#14213d"
              strokeWidth="0.3"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** The wall behind the desk: a picture rail and a clock that moves. */
function BackWall() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 500 400"
      className="absolute inset-0 size-full"
      fill="none"
      stroke="#14213d"
      strokeWidth="3"
    >
      <path d="M-4 36 H504" strokeWidth="2" opacity="0.4" />
      <circle cx="380" cy="25" r="18" fill="#ffffff" />
      <path
        d="M380 10 V13 M380 37 V40 M365 25 H368 M392 25 H395"
        strokeWidth="2"
      />
      <path d="M380 25 L380 15" strokeWidth="3" className="landing-hand-slow" />
      <path d="M380 25 L389 25" strokeWidth="2" className="landing-hand-fast" />
      <circle cx="380" cy="25" r="2" fill="#14213d" />
    </svg>
  );
}

/** The desk, its drawers and a mug, still warm. */
function FrontDesk() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 500 400"
      className="absolute inset-0 size-full"
      fill="none"
      stroke="#14213d"
      strokeWidth="3"
    >
      <rect x="20" y="322" width="460" height="90" fill="#e4dccb" />
      <rect x="330" y="336" width="134" height="30" fill="#f5f1e8" />
      <rect x="330" y="372" width="134" height="30" fill="#f5f1e8" />
      <path d="M385 351 H409 M385 387 H409" strokeWidth="4" stroke="#d9a84e" />
      <rect x="-4" y="310" width="508" height="14" fill="#6b4226" />

      <path
        d="M244 284 h20 v22 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 z"
        fill="#b23a2b"
      />
      <path d="M264 289 h4 a5 5 0 0 1 0 10 h-4" />
      <path
        className="landing-steam"
        d="M250 276 q-4 -7 0 -12 q4 -6 0 -12"
        strokeWidth="2"
      />
      <path
        className="landing-steam [animation-delay:-1.2s]"
        d="M258 276 q-4 -7 0 -12 q4 -6 0 -12"
        strokeWidth="2"
      />
    </svg>
  );
}
