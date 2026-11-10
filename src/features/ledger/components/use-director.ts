"use client";

import { animate, useReducedMotion } from "motion/react";
import { type RefObject, useCallback, useRef, useState } from "react";
import { cutBlock, type Pace, type PlanStep } from "../domain/build-plan";
import {
  beatsForStep,
  closingBeats,
  openingBeats,
} from "../domain/choreography";
import { type ContentBlock, contentTree } from "../domain/content-tree";
import {
  chooseGait,
  type Grip,
  gripFor,
  haulGait,
  holdOffset,
} from "../domain/gait";
import { SOURCE_ATTRIBUTE } from "../domain/source-paths";
import type { CatPose } from "./cat";
import type { PlacedBlock } from "./placed-block";

export type CatView = {
  pose: CatPose;
  flip: boolean;
  rot: number;
  /** A one-shot squash or stretch on his whole body; `bodyKey` restarts it. */
  body: string;
  bodyKey: number;
  say: string | null;
  /** Which way his speech bubble opens, so it never runs off the screen. */
  sayAlign: "left" | "right";
};

export type Flight = {
  id: string;
  block: ContentBlock;
  grip: Grip;
  width: number;
};
export type Fx = {
  id: number;
  kind: "fx-dust" | "fx-smoke" | "fx-tada";
  x: number;
  y: number;
  text: string;
};
export type Print = {
  id: number;
  x: number;
  y: number;
  rotate: number;
  delay: number;
};

export type PlayCallbacks = {
  /** A block was stamped onto the Build board. */
  onPlace: (item: PlacedBlock) => void;
  /** Swap the page copy for the answer page; the board's blocks slide over. */
  onReform: () => void;
  /** Swap the answer page back for the page copy, board cleared. */
  onRewind: () => void;
};

export type PlayInput = PlayCallbacks & {
  buildId: string;
  steps: AsyncIterable<PlanStep>;
  followUp: boolean;
  /** Read when Reform starts: the title is known by then. */
  title: () => string;
};

export type PlayResult = "reformed" | "not_found" | "cancelled";

class Cancelled extends Error {}

const SMOOTH: [number, number, number, number] = [0.45, 0.05, 0.25, 1];
const WORDS: Record<string, string> = {
  run: "ZOOM!",
  "run-down": "ZIP!",
  "run-up": "ZIP!",
  fly: "WHOOSH!",
};

type Point = { x: number; y: number };

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Plays Builds: turns each validated step into beats and performs them on the
 * real page, measuring where every piece is as it goes. Starting a new Build
 * or calling `stop` cancels the one in progress.
 */
export function useDirector(refs: {
  slot: RefObject<HTMLDivElement | null>;
  home: RefObject<HTMLElement | null>;
  copy: RefObject<HTMLElement | null>;
  /** On narrow screens the board and chat sit in a bottom panel. */
  panel: RefObject<HTMLElement | null>;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const catRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const position = useRef<Point>({ x: -200, y: 200 });
  const generation = useRef(0);
  const ids = useRef(0);
  const [cat, setCatView] = useState<CatView>({
    pose: "wave",
    flip: false,
    rot: 0,
    body: "",
    bodyKey: 0,
    say: null,
    sayAlign: "left",
  });
  const [flight, setFlight] = useState<Flight | null>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [prints, setPrints] = useState<Print[]>([]);
  const [size, setSize] = useState(120);

  const setCat = useCallback((patch: Partial<Omit<CatView, "bodyKey">>) => {
    setCatView((current) => ({
      ...current,
      ...patch,
      sayAlign: position.current.x > window.innerWidth / 2 ? "right" : "left",
      bodyKey: patch.body !== undefined ? current.bodyKey + 1 : current.bodyKey,
    }));
  }, []);

  const addFx = useCallback((kind: Fx["kind"], at: Point, text = "") => {
    const id = ++ids.current;
    setFx((list) => [...list, { id, kind, x: at.x, y: at.y, text }]);
    setTimeout(
      () => setFx((list) => list.filter((item) => item.id !== id)),
      1700,
    );
  }, []);

  const play = useCallback(
    async (input: PlayInput): Promise<PlayResult> => {
      const token = ++generation.current;
      const check = () => {
        if (token !== generation.current) throw new Cancelled();
      };
      /* Reduced motion swaps movement for fades, but keeps every pause at full length so the Build is still easy to follow. */
      const wait = async (ms: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        check();
      };

      /** Reduced motion: fades the elements out, moves them while hidden, fades them back in. */
      const fadeMove = async (moves: [Element, Record<string, number>][]) => {
        await Promise.all(
          moves.map(([element]) =>
            animate(element, { opacity: 0 }, { duration: 0.25 }),
          ),
        );
        await Promise.all(
          moves.map(([element, to]) => animate(element, to, { duration: 0 })),
        );
        await Promise.all(
          moves.map(([element]) =>
            animate(element, { opacity: 1 }, { duration: 0.25 }),
          ),
        );
        check();
      };

      const catSize =
        window.innerWidth < 640 ? 72 : window.innerWidth < 1024 ? 96 : 120;
      setSize(catSize);
      const dims = { w: catSize, h: Math.round((catSize * 250) / 240) };
      const stageBottom = () => {
        const panel = refs.panel.current?.getBoundingClientRect();
        return panel && panel.top > window.innerHeight * 0.3
          ? panel.top
          : window.innerHeight;
      };
      const clamp = (point: Point): Point => ({
        x: Math.min(Math.max(point.x, 8), window.innerWidth - dims.w - 8),
        y: Math.min(Math.max(point.y, 72), window.innerHeight - dims.h - 8),
      });
      const catAt = (point: Point) =>
        ({
          x: point.x + dims.w / 2,
          y: point.y + dims.h * 0.88,
        }) satisfies Point;

      const jump = async (to: Point) => {
        const element = catRef.current;
        if (!element) return;
        await animate(element, { x: to.x, y: to.y }, { duration: 0 });
        position.current = to;
      };

      const leavePrints = (from: Point, to: Point, duration: number) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const count = Math.max(4, Math.round(Math.hypot(dx, dy) / 44));
        const angle = Math.atan2(dy, dx);
        const fresh = Array.from({ length: count }, (_, index) => {
          const t = (index + 1) / count;
          const side = index % 2 ? 7 : -7;
          return {
            id: ++ids.current,
            x: from.x + dims.w / 2 + dx * t - Math.sin(angle) * side,
            y: from.y + dims.h * 0.9 + dy * t + Math.cos(angle) * side,
            rotate: (angle * 180) / Math.PI + 90,
            delay: t * duration,
          };
        });
        setPrints((list) => [...list.slice(-40), ...fresh]);
      };

      const travelTo = async (target: Point, pace: Pace) => {
        const to = clamp(target);
        const from = position.current;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (Math.hypot(dx, dy) < 6) return;
        const element = catRef.current;
        if (!element) return;
        if (reduceMotion) {
          await fadeMove([[element, { x: to.x, y: to.y }]]);
          position.current = to;
          await wait(520);
          return;
        }
        const gait = chooseGait(dx, dy, pace);
        setCat({ pose: "idle", flip: false, rot: 0, body: "lgr-crouch" });
        await wait(300);
        addFx(
          gait.pose === "fly" ? "fx-smoke" : "fx-dust",
          catAt(from),
          WORDS[gait.pose],
        );
        if (gait.pose !== "fly") leavePrints(from, to, gait.duration);
        setCat({
          pose: gait.pose,
          flip: gait.flip,
          rot: gait.rot,
          body: "lgr-launch",
        });
        await animate(
          element,
          { x: to.x, y: to.y },
          {
            duration: gait.duration,
            ease: gait.pose === "fly" ? [0.45, 0, 0.55, 1] : SMOOTH,
          },
        );
        position.current = to;
        check();
        const skid = gait.pose === "run";
        setCat({
          pose: "idle",
          flip: false,
          rot: 0,
          body: skid ? "lgr-skid" : "lgr-land",
        });
        addFx(
          "fx-dust",
          catAt(to),
          skid ? "SKRRT!" : gait.pose === "fly" ? "THUD!" : "",
        );
        await wait(520);
      };

      /**
       * Scrolls the page so the piece sits in the open part of the screen, and
       * waits until it is there: he only measures where to run once the page
       * has stopped moving under him.
       */
      const bringIntoView = async (element: Element) => {
        const rect = element.getBoundingClientRect();
        const visible = stageBottom();
        const height = Math.min(rect.height, visible * 0.6);
        const furthest =
          document.documentElement.scrollHeight - window.innerHeight;
        const top = Math.round(
          Math.min(
            furthest,
            Math.max(
              0,
              window.scrollY + rect.top - Math.max(84, (visible - height) / 2),
            ),
          ),
        );
        if (Math.abs(window.scrollY - top) < 2) return;
        window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
        // A smooth scroll can take a few frames to start, so one still frame
        // is not the end of it; give up only once it has been still a while.
        let last = window.scrollY;
        let still = 0;
        for (
          let index = 0;
          index < 240 && Math.abs(window.scrollY - top) >= 2 && still < 24;
          index++
        ) {
          await frame();
          if (window.scrollY === last) still++;
          else {
            still = 0;
            last = window.scrollY;
          }
        }
        check();
      };

      /* Just left of the piece, where it tears from; on a full-width piece he steps onto its edge. */
      const besidePiece = (rect: DOMRect): Point => ({
        x: Math.max(8, rect.left - dims.w * 0.85),
        y: rect.top + Math.min(rect.height, 200) / 2 - dims.h * 0.55,
      });

      const findPiece = (source: string) =>
        refs.copy.current?.querySelector(
          `[${SOURCE_ATTRIBUTE}="${CSS.escape(source)}"]`,
        ) ?? null;

      const goHome = async () => {
        const home = refs.home.current?.getBoundingClientRect();
        if (!home) return;
        await travelTo(
          { x: home.right - dims.w - 12, y: home.top - dims.h + 14 },
          "trot",
        );
        setCat({ pose: "idle", say: null });
      };

      /* ---------- the beats ---------- */

      const unstitch = async () => {
        await jump({ x: -dims.w - 40, y: window.innerHeight * 0.32 });
        setCat({ pose: "idle", say: null });
        await travelTo({ x: 24, y: window.innerHeight * 0.32 }, "dash");
        setCat({ pose: "unstitch", say: "Let me take this apart…" });
        refs.copy.current?.classList.add("ldg-seam");
        addFx("fx-dust", catAt(position.current), "RRRIP!");
        await wait(1300);
        refs.copy.current?.classList.remove("ldg-seam");
      };

      const rewind = async () => {
        setCat({ pose: "conduct", say: "Putting it all back…" });
        input.onRewind();
        window.scrollTo({ top: 0, behavior: "auto" });
        await wait(1100);
      };

      let placed = 0;
      let stepIndex = 0;
      let currentSource = "";
      let currentExcerpt: string | null = null;
      let currentJoin = "";
      let element: Element | null = null;
      let flying: Flight | null = null;

      const runTo = async (source: string, pace: Pace) => {
        element = findPiece(source);
        if (!element) return false;
        setCat({ say: null });
        await bringIntoView(element);
        await travelTo(besidePiece(element.getBoundingClientRect()), pace);
        return true;
      };

      const rip = async (step: PlanStep, slotWidth: number) => {
        const node = contentTree.get(step.source);
        if (!node || !element) return;
        const rect = element.getBoundingClientRect();
        element.classList.add("ldg-torn");
        const block = cutBlock(node, step.excerpt);
        flying = {
          id: `${input.buildId}-${stepIndex}`,
          block,
          grip: gripFor(block.kind),
          width: slotWidth,
        };
        setFlight(flying);
        setCat({ pose: "idle", say: step.line || null });
        await frame();
        await frame();
        const flyer = flightRef.current;
        if (flyer) {
          await animate(
            flyer,
            { x: rect.left, y: rect.top, opacity: 0, rotate: 0, scale: 0.9 },
            { duration: 0 },
          );
          await animate(
            flyer,
            { opacity: 1, scale: 1, rotate: -3 },
            { duration: 0.25 },
          );
        }
        addFx("fx-dust", { x: rect.left + 24, y: rect.top + 12 }, "RIIIP!");
        await wait(800);
      };

      const toss = async () => {
        const flyer = flightRef.current;
        setCat({ pose: "toss" });
        await wait(360);
        if (flyer) {
          const away = position.current.x > window.innerWidth / 2 ? -1 : 1;
          await animate(
            flyer,
            {
              x: away > 0 ? window.innerWidth + 80 : -480,
              y: -320,
              rotate: away * 540,
              opacity: 0,
            },
            reduceMotion
              ? {
                  duration: 0.4,
                  x: { duration: 0 },
                  y: { duration: 0 },
                  rotate: { duration: 0 },
                }
              : { duration: 1, ease: [0.3, 0, 0.6, 1] },
          );
        }
        element?.classList.remove("ldg-torn");
        setFlight(null);
        flying = null;
        addFx("fx-dust", catAt(position.current), "NOPE!");
        await wait(450);
      };

      const haul = async (grip: Grip, pace: Pace) => {
        const slot = refs.slot.current;
        const flyer = flightRef.current;
        const cat = catRef.current;
        if (!slot || !flyer || !cat) return;
        slot.scrollIntoView({ block: "nearest", inline: "nearest" });
        await frame();
        const target = slot.getBoundingClientRect();
        const now = flyer.getBoundingClientRect();
        const block = { w: flyer.offsetWidth, h: flyer.offsetHeight };
        const flip =
          target.left + target.width / 2 < now.left + now.width / 2 - 4;
        const hold = holdOffset(grip, flip, dims, block);
        const held = (at: Point) => ({ x: at.x + hold.x, y: at.y + hold.y });
        const from = position.current;
        // He stands where the block in his paws lands right on its slot.
        const to = clamp({ x: target.left - hold.x, y: target.top - hold.y });
        const gait = haulGait(to.x - from.x, to.y - from.y, grip, pace);
        const duration = gait.duration;

        if (reduceMotion) {
          // Picks it up and appears with it on the board, no sliding.
          setCat({ pose: grip, flip, say: null });
          await wait(450);
          await fadeMove([
            [cat, { x: to.x, y: to.y }],
            [flyer, { x: target.left, y: target.top, rotate: 0, scale: 1 }],
          ]);
          position.current = to;
          await wait(450);
          return;
        }

        // Picks it up: the block settles into his paws before he sets off.
        setCat({ pose: grip, flip, say: null });
        await animate(
          flyer,
          { ...held(from), rotate: 0, scale: 1 },
          { duration: 0.45, ease: SMOOTH },
        );
        check();

        // Same start, duration and easing for both, so the gap between his
        // paws and the block stays the same the whole way.
        leavePrints(from, to, duration);
        await Promise.all([
          animate(cat, { x: to.x, y: to.y }, { duration, ease: SMOOTH }),
          animate(flyer, held(to), { duration, ease: SMOOTH }),
        ]);
        position.current = to;
        check();

        // Sets it down, a nudge when the edge of the screen kept him off it.
        await animate(
          flyer,
          { x: target.left, y: target.top, rotate: 0, scale: 1 },
          { duration: 0.35, ease: SMOOTH },
        );
        check();
      };

      const stamp = async () => {
        const slot = refs.slot.current?.getBoundingClientRect();
        setCat({ pose: "stamp", flip: false });
        await wait(320);
        if (flying) {
          input.onPlace({
            id: flying.id,
            source: currentSource,
            excerpt: currentExcerpt,
            join: currentJoin,
            block: flying.block,
          });
          placed++;
        }
        setFlight(null);
        flying = null;
        if (slot)
          addFx(
            "fx-dust",
            { x: slot.left + slot.width / 2, y: slot.top + 20 },
            "FILED!",
          );
        await wait(650);
      };

      const reform = async () => {
        setCat({
          pose: "conduct",
          flip: false,
          rot: 0,
          say: input.title() || "Ta-da!",
        });
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
        await wait(650);
        input.onReform();
        await wait(1300);
        setCat({ pose: "found", say: null });
        addFx(
          "fx-tada",
          { x: position.current.x + dims.w / 2, y: position.current.y },
          "TA-DA!",
        );
        await wait(1300);
        await goHome();
      };

      try {
        if (catRef.current) catRef.current.style.opacity = "1";
        for (const beat of openingBeats(input.followUp)) {
          if (beat.type === "unstitch") await unstitch();
          else await rewind();
        }
        setCat({ pose: "search", say: "Checking my ledger…" });

        for await (const step of input.steps) {
          check();
          const node = contentTree.get(step.source);
          if (!node) continue;
          currentSource = step.source;
          currentExcerpt = step.excerpt;
          currentJoin = step.join;
          const slotWidth =
            refs.slot.current?.getBoundingClientRect().width ?? 260;
          for (const beat of beatsForStep(step, node.block.kind)) {
            if (beat.type === "run-to") {
              if (!(await runTo(beat.source, beat.pace))) break;
            } else if (beat.type === "rip") await rip(step, slotWidth);
            else if (beat.type === "toss") await toss();
            else if (beat.type === "haul") await haul(beat.grip, beat.pace);
            else if (beat.type === "stamp") await stamp();
          }
          stepIndex++;
          setCat({ pose: "search", say: null });
        }
        check();

        if (closingBeats(placed).length > 0) {
          await reform();
          return "reformed";
        }
        setCat({ pose: "confused", say: "Not on my ledger!" });
        await wait(2400);
        await goHome();
        return "not_found";
      } catch (error) {
        if (error instanceof Cancelled) return "cancelled";
        throw error;
      }
    },
    [addFx, reduceMotion, refs, setCat],
  );

  /** Puts Ledger by the chat without a Build, e.g. when a stored session opens. */
  const settle = useCallback(
    async (pose: CatPose = "wave") => {
      generation.current++;
      setFlight(null);
      const catSize =
        window.innerWidth < 640 ? 72 : window.innerWidth < 1024 ? 96 : 120;
      setSize(catSize);
      const home = refs.home.current?.getBoundingClientRect();
      const element = catRef.current;
      if (!home || !element) return;
      const to = {
        x: home.right - catSize - 12,
        y: home.top - Math.round((catSize * 250) / 240) + 14,
      };
      await animate(element, { x: to.x, y: to.y, opacity: 1 }, { duration: 0 });
      position.current = to;
      setCat({ pose, flip: false, rot: 0, say: null });
    },
    [refs, setCat],
  );

  const stop = useCallback(() => {
    generation.current++;
    setFlight(null);
  }, []);

  return {
    play,
    settle,
    stop,
    cat,
    size,
    flight,
    fx,
    prints,
    catRef,
    flightRef,
  };
}
