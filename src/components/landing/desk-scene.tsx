"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import "./landing.css";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { desk } from "@/content/landing";
import { Cat, type CatPose } from "@/features/ledger/components/cat";
import { RevealWords } from "./reveal";
import { useTimers } from "./use-timers";

/** Pages in the pile. Small on purpose: the game takes seconds, not minutes. */
const SHEETS = 6;
/** The stage is 100cqw wide and 80cqw tall; the desk top sits at 50cqw. */
const DESK_TOP = 50;
const SHEET_HEIGHT = 2.6;
const TRAY_SHEET = 1.3;
/** Seconds a page takes from the pile, past Ledger's stamp, to the tray. */
const FLIGHT = 0.95;
/** Ledger dozes off when nobody has touched the desk for this long. */
const DOZE_MS = 12_000;

type Flight = { id: number; from: number; to: number };

/** The opening scene: what the site is in two lines, and a desk to play with. */
export function DeskScene() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const timers = useTimers();

  const [left, setLeft] = useState(SHEETS);
  const [done, setDone] = useState(0);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pose, setPose] = useState<CatPose>("idle");
  const [bubble, setBubble] = useState<string | null>(null);
  const [touched, setTouched] = useState(0);
  const nextFlight = useRef(0);
  const nextLine = useRef(0);
  const allDone = done === SHEETS;

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

  // Ledger dozes when the desk is left alone, and only from his idle pose.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `touched` restarts the doze clock.
  useEffect(() => {
    const id = window.setTimeout(
      () => setPose((current) => (current === "idle" ? "sleep" : current)),
      DOZE_MS,
    );
    return () => window.clearTimeout(id);
  }, [touched]);

  function wake() {
    setTouched((count) => count + 1);
    setPose((current) => (current === "sleep" ? "idle" : current));
  }

  function handPage() {
    if (left === 0) return;
    wake();
    const id = nextFlight.current++;
    // `from` is the pile's height before this page left; `to` is its spot in the tray.
    setFlights((current) => [
      ...current,
      { id, from: left, to: done + current.length },
    ]);
    setLeft(left - 1);
    setBubble(null);
    timers.later(() => setPose("stamp"), FLIGHT * 420);
    timers.later(
      () => setPose((current) => (current === "stamp" ? "idle" : current)),
      FLIGHT * 900,
    );
  }

  function landed(id: number) {
    setFlights((current) => current.filter((flight) => flight.id !== id));
    setDone((count) => count + 1);
  }

  // The last page in the tray: Ledger celebrates.
  useEffect(() => {
    if (!allDone) return;
    const id = window.setTimeout(() => {
      setPose("found");
      setBubble(desk.doneLine);
    }, 120);
    return () => window.clearTimeout(id);
  }, [allDone]);

  function restack() {
    wake();
    setLeft(SHEETS);
    setDone(0);
    setPose("idle");
    setBubble(null);
  }

  function greet() {
    wake();
    const line = desk.catLines[nextLine.current % desk.catLines.length];
    nextLine.current += 1;
    setPose("wave");
    setBubble(line);
    timers.later(() => {
      setPose((current) => (current === "wave" ? "idle" : current));
      setBubble((current) => (current === line ? null : current));
    }, 2400);
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

              <button
                type="button"
                onClick={handPage}
                disabled={left === 0}
                aria-label={`Hand Ledger a page to check. ${left} left in the pile.`}
                className="group absolute flex cursor-pointer flex-col-reverse items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-federal-blue disabled:cursor-default"
                style={{
                  left: "4cqw",
                  bottom: `${80 - DESK_TOP}cqw`,
                  width: "24cqw",
                  height: `${SHEETS * SHEET_HEIGHT + 6}cqw`,
                }}
              >
                {Array.from({ length: left }, (_, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: sheets are interchangeable.
                    key={index}
                    className="block border-2 border-ink bg-paper transition-transform group-hover:-translate-y-0.5 group-active:translate-y-0"
                    style={{
                      width: "21cqw",
                      height: `${SHEET_HEIGHT}cqw`,
                      transform: `translateX(${((index * 37) % 5) - 2}cqw) rotate(${((index * 53) % 7) - 3}deg)`,
                    }}
                  />
                ))}
                {left > 0 && !reduce ? (
                  <span
                    aria-hidden="true"
                    className="landing-nudge mb-1 font-mono text-[2.4cqw] font-bold text-federal-blue"
                  >
                    tap ↓
                  </span>
                ) : null}
              </button>

              {/* What's in the tray, stamped. */}
              {Array.from({ length: done }, (_, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: sheets are interchangeable.
                  key={index}
                  aria-hidden="true"
                  className="absolute border-2 border-ink bg-paper"
                  style={{
                    left: `${68.5 + ((index * 3) % 2)}cqw`,
                    top: `${DESK_TOP - 3 - (index + 1) * TRAY_SHEET}cqw`,
                    width: "18cqw",
                    height: `${TRAY_SHEET}cqw`,
                  }}
                />
              ))}

              {flights.map((flight) => (
                <FlyingPage
                  key={flight.id}
                  flight={flight}
                  reduce={Boolean(reduce)}
                  onLanded={() => landed(flight.id)}
                />
              ))}

              <button
                type="button"
                onClick={greet}
                aria-label="Say hello to Ledger"
                className="absolute cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue [&>svg]:h-auto [&>svg]:w-full"
                style={{ left: "35cqw", top: "24cqw", width: "28cqw" }}
              >
                <Cat pose={pose} size={240} animate={!reduce} />
              </button>

              {bubble ? (
                <motion.p
                  key={bubble}
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="outline-box absolute rounded-sm bg-paper px-[1.6cqw] py-[1cqw] text-center font-mono text-[2.6cqw] leading-tight font-bold shadow-hard-sm"
                  style={{ left: "52cqw", top: "6cqw", width: "34cqw" }}
                >
                  {bubble}
                </motion.p>
              ) : null}
            </motion.div>
          </div>

          <div className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted" aria-live="polite">
              {allDone
                ? `All ${SHEETS} pages checked and stamped.`
                : done > 0
                  ? `${done} of ${SHEETS} pages checked.`
                  : desk.hint}
            </p>
            {allDone ? (
              <button
                type="button"
                onClick={restack}
                className="eyebrow outline-box press rounded-sm bg-paper px-3 py-2 font-bold"
              >
                Stack them again
              </button>
            ) : null}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** One page's trip: off the pile, under Ledger's stamp, into the tray. */
function FlyingPage({
  flight,
  reduce,
  onLanded,
}: {
  flight: Flight;
  reduce: boolean;
  onLanded: () => void;
}) {
  const fromTop = DESK_TOP - flight.from * SHEET_HEIGHT - 8;
  const toTop = DESK_TOP - 3 - (flight.to + 1) * TRAY_SHEET - 6;
  return (
    <motion.span
      aria-hidden="true"
      className="absolute flex flex-col gap-[0.8cqw] border-2 border-ink bg-paper p-[1cqw] shadow-hard-sm"
      style={{ width: "8cqw", height: "10cqw" }}
      initial={{ left: "10cqw", top: `${fromTop}cqw`, rotate: -8, opacity: 1 }}
      animate={{
        left: ["10cqw", "40cqw", "46cqw", "72cqw"],
        top: [`${fromTop}cqw`, "22cqw", "30cqw", `${toTop}cqw`],
        rotate: [-8, 6, 0, 3],
        opacity: [1, 1, 1, 0],
      }}
      transition={{
        duration: reduce ? 0.01 : FLIGHT,
        times: [0, 0.35, 0.55, 1],
        ease: "easeInOut",
      }}
      onAnimationComplete={onLanded}
    >
      <span className="h-[0.6cqw] w-full bg-ink/60" />
      <span className="h-[0.6cqw] w-3/4 bg-ink/40" />
      <span className="h-[0.6cqw] w-full bg-ink/40" />
      <motion.span
        className="mt-auto self-end border-2 border-ivy px-[0.4cqw] font-mono text-[1.4cqw] leading-none font-bold text-ivy"
        initial={{ opacity: 0, scale: 2 }}
        animate={{ opacity: [0, 0, 1], scale: [2, 2, 1] }}
        transition={{
          duration: reduce ? 0.01 : FLIGHT * 0.6,
          times: [0, 0.75, 1],
        }}
      >
        OK
      </motion.span>
    </motion.span>
  );
}

/** The wall behind the desk: a window on the city, a framed certificate, a clock. */
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
      <defs>
        <clipPath id="landing-window">
          <rect x="170" y="38" width="170" height="132" />
        </clipPath>
      </defs>
      <rect x="170" y="38" width="170" height="132" fill="#d6e4f5" />
      <g clipPath="url(#landing-window)">
        <circle cx="296" cy="78" r="16" fill="#d9a84e" />
        <g className="landing-cloud">
          <path
            d="M150 76 q10 -16 26 -8 q10 -14 26 -2 q16 0 14 12 h-66 z"
            fill="#ffffff"
            strokeWidth="2.5"
          />
        </g>
        <g fill="#1d4e89" strokeWidth="2.5">
          <rect x="174" y="118" width="22" height="56" />
          <rect x="200" y="100" width="18" height="74" />
          <rect x="222" y="126" width="26" height="48" />
          <rect x="252" y="92" width="16" height="82" />
          <rect x="272" y="112" width="30" height="62" />
          <rect x="306" y="130" width="34" height="44" />
        </g>
        <g fill="#6fa0dc" stroke="none">
          <rect x="204" y="108" width="4" height="4" />
          <rect x="210" y="120" width="4" height="4" />
          <rect x="256" y="102" width="4" height="4" />
          <rect x="256" y="116" width="4" height="4" />
          <rect x="280" y="122" width="4" height="4" />
          <rect x="290" y="134" width="4" height="4" />
        </g>
      </g>
      <path d="M255 38 V170 M170 104 H340" strokeWidth="3" />
      <rect x="170" y="38" width="170" height="132" strokeWidth="4" />
      <path d="M160 176 H350" strokeWidth="5" />

      {/* A certificate, slightly crooked, as they always are. */}
      <g transform="rotate(-4 80 72) translate(0 -40)">
        <rect x="42" y="62" width="76" height="98" fill="#ffffff" />
        <path
          d="M54 80 H106 M54 92 H100 M54 104 H106 M54 116 H92"
          strokeWidth="2"
        />
        <circle cx="94" cy="140" r="9" fill="#d9a84e" strokeWidth="2" />
      </g>

      {/* A clock that actually moves. */}
      <circle cx="420" cy="98" r="26" fill="#ffffff" />
      <path
        d="M420 76 V80 M420 116 V120 M398 98 H402 M438 98 H442"
        strokeWidth="2"
      />
      <path d="M420 98 L420 84" strokeWidth="3" className="landing-hand-slow" />
      <path d="M420 98 L432 98" strokeWidth="2" className="landing-hand-fast" />
      <circle cx="420" cy="98" r="2.5" fill="#14213d" />
    </svg>
  );
}

/** The desk, a lamp, a mug and the tray the checked pages land in. */
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
      <rect x="-4" y="368" width="508" height="40" fill="#e4dccb" />
      <polygon
        className="landing-lamp"
        points="372,170 412,152 470,250 330,250"
        fill="#d9a84e"
        stroke="none"
      />
      <rect x="20" y="262" width="460" height="108" fill="#e4dccb" />
      <rect x="330" y="278" width="134" height="38" fill="#f5f1e8" />
      <rect x="330" y="322" width="134" height="38" fill="#f5f1e8" />
      <path d="M385 297 H409 M385 341 H409" strokeWidth="4" stroke="#d9a84e" />
      <rect x="-4" y="248" width="508" height="16" fill="#6b4226" />

      {/* Lamp. */}
      <ellipse cx="460" cy="246" rx="22" ry="5" fill="#14213d" />
      <path d="M460 244 L438 176 L404 150" strokeWidth="4" />
      <polygon points="364,166 404,136 420,160 384,186" fill="#d9a84e" />

      {/* Tray. */}
      <path d="M338 234 V248 H440 V234" fill="#ffffff" />
      <text
        x="389"
        y="245"
        textAnchor="middle"
        fontSize="9"
        fontFamily="ui-monospace, monospace"
        fontWeight="700"
        fill="#2f6b3f"
        stroke="none"
      >
        DONE
      </text>

      {/* Mug, still warm. */}
      <path
        d="M140 222 h24 v22 a4 4 0 0 1 -4 4 h-16 a4 4 0 0 1 -4 -4 z"
        fill="#b23a2b"
      />
      <path d="M164 228 h5 a5 5 0 0 1 0 10 h-5" />
      <path
        className="landing-steam"
        d="M146 214 q-4 -7 0 -12 q4 -6 0 -12"
        strokeWidth="2"
      />
      <path
        className="landing-steam [animation-delay:-1.2s]"
        d="M156 214 q-4 -7 0 -12 q4 -6 0 -12"
        strokeWidth="2"
      />
    </svg>
  );
}
