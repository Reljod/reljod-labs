"use client";

import { animate, useReducedMotion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import type { LogTone } from "@/components/ui/terminal";
import {
  cutBlock,
  type Pace,
  type PlanStep,
  type Sentence,
} from "../domain/build-plan";
import {
  beatsForStep,
  closingBeats,
  openingBeats,
} from "../domain/choreography";
import { type ContentBlock, contentTree } from "../domain/content-tree";
import { chooseGait, type TravelPose } from "../domain/gait";
import { SOURCE_ATTRIBUTE } from "../domain/source-paths";
import { typingMs } from "./answer-page";
import type { CatPose } from "./cat";
import type { PlacedBlock } from "./placed-block";

export type CatView = {
  pose: CatPose;
  flip: boolean;
  rot: number;
  /** A one-shot squash, stretch or flip on his whole body; `bodyKey` restarts it. */
  body: string;
  bodyKey: number;
  say: string | null;
  /** Which way his speech bubble opens, so it never runs off the screen. */
  sayAlign: "left" | "right";
};

export type Flight = { id: string; block: ContentBlock; width: number };
export type Fx = {
  id: number;
  kind: "fx-dust" | "fx-smoke" | "fx-tada" | "fx-ring";
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

export type PlayInput = {
  buildId: string;
  steps: AsyncIterable<PlanStep>;
  followUp: boolean;
  /** Settles once the plan is stored; a replay has it at once. */
  writeup: () => Promise<Sentence[]>;
  /** The page copy is back and the Stack is open. */
  onBegin: () => void;
  /** A block was shoved onto the Stack. */
  onStack: (item: PlacedBlock) => void;
  /** Every piece is stacked: no more room needed for the next. */
  onStacked: () => void;
  /** Swap the answer back for the page copy, Stack cleared. */
  onRewind: () => void;
  /** The Stack becomes the answer page: Source blocks float off, sentences still unwritten. */
  onWrite: (writeup: Sentence[]) => void;
  /** How many sentences of the Write-up are written so far. */
  onType: (count: number) => void;
  onSettle: () => void;
};

export type DockInput = {
  box: HTMLElement;
  heroCat: HTMLElement;
  /** Ledger is out of the hero: hide the peeking one. */
  onLeave: () => void;
  /** The box is on its way: open the dock. */
  onPush: () => void;
  /** The box is gone. */
  onPushed: () => void;
};

export type PlayResult = "written" | "not_found" | "cancelled";

class Cancelled extends Error {}

/** A performance cut short by a newer one ends quietly; anything else is a bug. */
const caught = (error: unknown): "cancelled" => {
  if (error instanceof Cancelled) return "cancelled";
  throw error;
};

type Point = { x: number; y: number };
type Box = { w: number; h: number };

const SMOOTH: [number, number, number, number] = [0.45, 0.05, 0.25, 1];
const SCROLL_EASE: [number, number, number, number] = [0.3, 0, 0.25, 1];
/** Pixels of page a scroll run covers per second. */
const SCROLL_SPEED = 2600;
const WORDS: Record<TravelPose, string> = {
  run: "ZOOM!",
  "run-down": "ZIP!",
  "run-up": "ZIP!",
  fly: "WHOOSH!",
};
const OFF_WE_GO = ["On it!", "This way!", "Follow me!", "Hold my tie!"];
const KICKS = ["BOOT!", "OUT!", "SCRAM!", "BYE!", "POW!"];
const HEADER = 72;

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** His width for the screen: big on desktop, still readable on a phone. */
export const catSizeFor = (width: number) =>
  width < 640 ? 96 : width < 1024 ? 128 : 170;
const heightOf = (width: number) => Math.round((width * 250) / 240);

/**
 * Plays Builds: turns each validated step into beats and performs them on the
 * real page, measuring where every piece is as it goes. Starting a new Build,
 * the dock push or `stop` cancels the one in progress.
 */
export function useDirector(log: (text: string, tone: LogTone) => void) {
  const reduceMotion = useReducedMotion() ?? false;
  const catRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLLIElement>(null);
  const stackRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const logRef = useRef(log);
  logRef.current = log;
  const position = useRef<Point>({ x: -200, y: 200 });
  const generation = useRef(0);
  const ids = useRef(0);
  const kicked = useRef<Animation[]>([]);
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
  const [size, setSize] = useState(170);

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

  /** Puts every kicked section back where it was. */
  const restore = useCallback(() => {
    for (const animation of kicked.current) animation.cancel();
    kicked.current = [];
    for (const section of copyRef.current?.children ?? []) {
      section.classList.remove("ldg-kicked");
    }
  }, []);

  /**
   * Everything a performance needs, bound to one generation: once another
   * starts, every wait in this one throws and it stops where it is.
   */
  const stage = useCallback(() => {
    const token = ++generation.current;
    const check = () => {
      if (token !== generation.current) throw new Cancelled();
    };
    const wait = async (ms: number) => {
      await new Promise((resolve) =>
        setTimeout(resolve, reduceMotion ? Math.min(ms, 120) : ms),
      );
      check();
    };
    const say = (text: string, tone: LogTone = "muted") =>
      logRef.current(text, tone);

    const w = catSizeFor(window.innerWidth);
    const h = heightOf(w);
    setSize(w);
    const show = () => {
      if (catRef.current) catRef.current.style.opacity = "1";
    };

    const dockIsSheet = () => {
      const dock = dockRef.current?.getBoundingClientRect();
      return !!dock && dock.top > window.innerHeight * 0.3;
    };
    /** Where the stage ends: above the chat sheet on a phone. */
    const stageBottom = () =>
      dockIsSheet()
        ? (dockRef.current?.getBoundingClientRect().top ?? window.innerHeight)
        : window.innerHeight;
    const stageRight = () =>
      dockIsSheet() || !dockRef.current
        ? window.innerWidth
        : dockRef.current.offsetLeft;
    const clamp = (point: Point): Point => ({
      x: Math.min(Math.max(point.x, 4), window.innerWidth - w - 4),
      y: Math.min(Math.max(point.y, HEADER), window.innerHeight - h - 4),
    });
    const feet = (point: Point): Point => ({
      x: point.x + w / 2,
      y: point.y + h * 0.9,
    });

    const shake = () => {
      const page = pageRef.current;
      if (!page || reduceMotion) return;
      page.classList.remove("lgr-shake");
      void page.offsetWidth;
      page.classList.add("lgr-shake");
      setTimeout(() => page.classList.remove("lgr-shake"), 450);
    };

    const jump = async (to: Point) => {
      const element = catRef.current;
      if (element)
        await animate(element, { x: to.x, y: to.y }, { duration: 0 });
      position.current = to;
    };

    const leavePrints = (from: Point, to: Point, duration: number) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const count = Math.max(4, Math.round(Math.hypot(dx, dy) / 46));
      const angle = Math.atan2(dy, dx);
      const fresh = Array.from({ length: count }, (_, index) => {
        const t = (index + 1) / count;
        const side = index % 2 ? 9 : -9;
        return {
          id: ++ids.current,
          x: from.x + w / 2 + dx * t - Math.sin(angle) * side,
          y: from.y + h * 0.92 + dy * t + Math.cos(angle) * side,
          rotate: (angle * 180) / Math.PI + 90,
          delay: t * duration,
        };
      });
      setPrints((list) => [...list.slice(-48), ...fresh]);
    };

    /** Where a block he is pushing rides: always out in front of him. */
    const ahead = (
      at: Point,
      pose: TravelPose,
      flip: boolean,
      box: Box,
    ): Point => {
      switch (pose) {
        case "run":
          return {
            x: flip ? at.x - box.w + w * 0.1 : at.x + w * 0.9,
            y: at.y + h * 0.94 - box.h,
          };
        case "run-up":
          return { x: at.x + w / 2 - box.w / 2, y: at.y - box.h + h * 0.12 };
        case "run-down":
          return { x: at.x + w / 2 - box.w / 2, y: at.y + h * 0.86 };
        case "fly":
          return {
            x: flip ? at.x - box.w + w * 0.15 : at.x + w * 0.85,
            y: at.y + h * 0.45 - box.h / 2,
          };
      }
    };

    const blockBox = (): Box => {
      const rect = flightRef.current?.getBoundingClientRect();
      return { w: rect?.width ?? 260, h: rect?.height ?? 120 };
    };

    /**
     * Crouch, launch, then gallop, fly or run in top or bottom view, picked
     * from the direction; skid or land at the end. With `pushing` the block
     * in flight rides out in front of him.
     */
    const travelTo = async (
      target: Point,
      pace: Pace,
      options: { pushing?: boolean; line?: string } = {},
    ) => {
      const to = clamp(target);
      const from = position.current;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.hypot(dx, dy) < 8) return;
      const element = catRef.current;
      if (!element) return;
      const flyer = options.pushing ? flightRef.current : null;
      const box = blockBox();
      if (reduceMotion) {
        await animate(element, { opacity: 0 }, { duration: 0.1 });
        await jump(to);
        if (flyer) {
          await animate(flyer, ahead(to, "run", dx < 0, box), { duration: 0 });
        }
        await animate(element, { opacity: 1 }, { duration: 0.1 });
        check();
        return;
      }
      const gait = chooseGait(dx, dy, pace, !!flyer);
      setCat({
        pose: "idle",
        flip: gait.flip,
        rot: 0,
        body: "lgr-crouch",
        say: options.line ?? null,
      });
      if (flyer) {
        await animate(flyer, ahead(from, gait.pose, gait.flip, box), {
          duration: 0.22,
          ease: "easeOut",
        });
      }
      await wait(180);
      addFx(
        gait.pose === "fly" ? "fx-smoke" : "fx-dust",
        feet(from),
        WORDS[gait.pose],
      );
      if (gait.pose !== "fly") leavePrints(from, to, gait.duration);
      setCat({
        pose: gait.pose,
        flip: gait.flip,
        rot: gait.rot,
        body: "lgr-launch",
        say: null,
      });
      say(
        `  ${gait.pose === "run" ? "gallop" : gait.pose} ${dx < 0 ? "←" : "→"} ${Math.round(Math.hypot(dx, dy))}px · ${gait.duration.toFixed(2)}s${flyer ? " · pushing" : ""}`,
      );
      const ease = gait.pose === "fly" ? ([0.45, 0, 0.55, 1] as const) : SMOOTH;
      await Promise.all([
        animate(
          element,
          { x: to.x, y: to.y },
          { duration: gait.duration, ease },
        ),
        flyer
          ? animate(flyer, ahead(to, gait.pose, gait.flip, box), {
              duration: gait.duration,
              ease,
            })
          : null,
      ]);
      position.current = to;
      check();
      const skid = gait.pose === "run";
      setCat({
        pose: "idle",
        flip: skid ? gait.flip : false,
        rot: 0,
        body: skid ? "lgr-skid" : "lgr-land",
      });
      addFx(
        gait.pose === "fly" ? "fx-smoke" : "fx-dust",
        feet(to),
        skid ? "SKRRT!" : gait.pose === "fly" ? "THUD!" : "",
      );
      if (gait.pose === "fly") shake();
      await wait(260);
    };

    /**
     * Runs up or down the page while it scrolls under him, so a long trip
     * reads as a sprint instead of a jump cut, and lands him at `place`: where
     * he wants to be once the page has moved by `shift`. With `pushing` the
     * block goes first.
     */
    const scrollRun = async (
      top: number,
      place: (shift: number) => Point,
      options: { pushing?: boolean; line?: string } = {},
    ) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const goal = Math.min(Math.max(top, 0), Math.max(max, 0));
      const distance = goal - window.scrollY;
      if (Math.abs(distance) < 48) return;
      const element = catRef.current;
      if (!element) return;
      const to = clamp(place(distance));
      if (reduceMotion) {
        window.scrollTo({ top: goal, behavior: "instant" });
        await jump(to);
        await frame();
        check();
        return;
      }
      const up = distance < 0;
      const pose: TravelPose = up ? "run-up" : "run-down";
      const flyer = options.pushing ? flightRef.current : null;
      const box = blockBox();
      const duration = Math.min(
        1.7,
        Math.max(0.7, Math.abs(distance) / SCROLL_SPEED),
      );
      setCat({
        pose: "idle",
        flip: false,
        rot: 0,
        body: "lgr-crouch",
        say: options.line ?? null,
      });
      await wait(160);
      addFx("fx-smoke", feet(position.current), up ? "UP!" : "DOWN!");
      setCat({ pose, body: "lgr-launch", say: null });
      say(
        `  ${pose} · page ${up ? "↑" : "↓"} ${Math.abs(Math.round(distance))}px · ${duration.toFixed(2)}s${flyer ? " · pushing" : ""}`,
      );
      await Promise.all([
        animate(window.scrollY, goal, {
          duration,
          ease: SCROLL_EASE,
          // The site scrolls smoothly by default; each frame must land exactly.
          onUpdate: (value) =>
            window.scrollTo({ top: value, behavior: "instant" }),
        }),
        animate(element, { x: to.x, y: to.y }, { duration, ease: SMOOTH }),
        flyer
          ? animate(flyer, ahead(to, pose, false, box), {
              duration,
              ease: SMOOTH,
            })
          : null,
      ]);
      position.current = to;
      check();
      setCat({ pose: "idle", body: "lgr-land" });
      addFx("fx-dust", feet(to), "");
      await wait(140);
    };

    /** The page scroll that puts `rect` about a third of the way down the open stage. */
    const scrollFor = (rect: DOMRect, at = 0.3) => {
      const visible = stageBottom() - HEADER;
      const height = Math.min(rect.height, visible * 0.6);
      return (
        window.scrollY +
        rect.top -
        HEADER -
        Math.max(16, (visible - height) * at)
      );
    };

    /** Where he waits between Builds: perched on the dock's edge. */
    const home = (): Point => {
      const dock = dockRef.current;
      if (!dock) {
        return { x: window.innerWidth - w - 24, y: window.innerHeight - h };
      }
      return dockIsSheet()
        ? {
            x: window.innerWidth - w - 12,
            y: dock.getBoundingClientRect().top - h + 16,
          }
        : { x: dock.offsetLeft - w * 0.55, y: window.innerHeight - h - 6 };
    };

    const goHome = async (pace: Pace = "trot") => {
      await travelTo(home(), pace);
      setCat({ pose: "wave", flip: false, say: null });
    };

    return {
      w,
      h,
      check,
      wait,
      say,
      show,
      jump,
      shake,
      travelTo,
      scrollRun,
      scrollFor,
      stageBottom,
      stageRight,
      ahead,
      feet,
      goHome,
      home,
    };
  }, [addFx, reduceMotion, setCat]);

  /**
   * From the home page: he hops out of the hero, runs round to the chat box
   * and shoves it across the screen into the dock while the page makes room.
   */
  const dock = useCallback(
    async (input: DockInput) => {
      const kit = stage();
      try {
        const hero = input.heroCat.getBoundingClientRect();
        await kit.jump({ x: hero.left, y: hero.top });
        kit.show();
        input.onLeave();
        kit.say("› ledger leaves the front desk", "info");
        setCat({
          pose: "idle",
          flip: false,
          rot: 0,
          body: "lgr-crouch",
          say: null,
        });
        await kit.wait(220);
        setCat({ pose: "found", body: "lgr-launch", say: "On it!" });
        addFx("fx-dust", kit.feet(position.current), "BOING!");
        const element = catRef.current;
        if (element && !reduceMotion) {
          const { x, y } = position.current;
          await animate(
            element,
            { x, y: [y, y - kit.h * 0.6, y - kit.h * 0.25] },
            { duration: 0.55, ease: "easeOut" },
          );
          position.current = { x, y: y - kit.h * 0.25 };
        }
        kit.check();

        const box = input.box.getBoundingClientRect();
        await kit.travelTo(
          { x: box.left - kit.w * 0.82, y: box.bottom - kit.h * 0.96 },
          "dash",
        );

        kit.say("› pushing the chat into the dock", "info");
        if (!reduceMotion) {
          setCat({
            pose: "run",
            flip: false,
            body: "lgr-launch",
            say: "Hnngh!",
          });
          addFx("fx-dust", kit.feet(position.current), "SHOVE!");
        }
        input.onPush();
        await frame();
        kit.check();
        const shove = window.innerWidth - box.left + 80;
        const stop = Math.min(
          position.current.x + shove,
          kit.stageRight() - kit.w * 0.95,
        );
        if (element && !reduceMotion) {
          await Promise.all([
            animate(
              input.box,
              { x: shove, rotate: 6 },
              { duration: 1, ease: [0.55, 0, 0.75, 0.2] },
            ),
            animate(
              element,
              { x: stop },
              { duration: 0.95, ease: [0.5, 0, 0.6, 1] },
            ),
          ]);
          position.current = { ...position.current, x: stop };
        }
        kit.check();
        input.onPushed();
        setCat({ pose: "idle", body: "lgr-skid", say: null });
        addFx("fx-dust", kit.feet(position.current), "SKRRT!");
        kit.shake();
        await kit.wait(420);
        await kit.goHome();
        setCat({ say: "Let's build!" });
        return "docked" as const;
      } catch (error) {
        return caught(error);
      }
    },
    [addFx, reduceMotion, setCat, stage],
  );

  const play = useCallback(
    async (input: PlayInput): Promise<PlayResult> => {
      const kit = stage();
      const { w, h } = kit;
      const startedAt = performance.now();

      const findPiece = (source: string) =>
        copyRef.current?.querySelector(
          `[${SOURCE_ATTRIBUTE}="${CSS.escape(source)}"]`,
        ) ?? null;

      /* Where `rect` will be once the page has scrolled by `shift`. */
      const moved = (rect: DOMRect, shift: number) =>
        new DOMRect(rect.x, rect.y - shift, rect.width, rect.height);

      /* Just left of the piece, where it tears from; with no room he stands on its edge. */
      const besidePiece = (rect: DOMRect): Point => ({
        x: rect.left > w * 0.7 ? rect.left - w * 0.85 : rect.left + 4,
        y:
          rect.left > w * 0.7
            ? rect.top + Math.min(rect.height, 200) / 2 - h * 0.55
            : rect.top - h * 0.85,
      });

      /* ---------- the beats ---------- */

      const unstitch = async () => {
        kit.say("› unstitching the page", "info");
        setCat({
          pose: "unstitch",
          flip: false,
          say: "Let me take this apart…",
        });
        copyRef.current?.classList.add("ldg-seam");
        addFx("fx-dust", kit.feet(position.current), "RRRIP!");
        kit.shake();
        await kit.wait(1300);
        copyRef.current?.classList.remove("ldg-seam");
      };

      const rewind = async () => {
        kit.say("› rewinding the last answer into the page", "info");
        setCat({ pose: "conduct", say: "Putting it all back…" });
        restore();
        input.onRewind();
        window.scrollTo({ top: 0, behavior: "instant" });
        await kit.wait(900);
      };

      let stacked = 0;
      let stepIndex = 0;
      let element: Element | null = null;
      let flying: (Flight & { source: string; excerpt: string | null }) | null =
        null;

      const runTo = async (source: string, pace: Pace) => {
        element = findPiece(source);
        if (!element) {
          kit.say(`  ! ${source} is not on the page`, "warn");
          return false;
        }
        kit.say(`→ run to ${source}`, "info");
        const rect = element.getBoundingClientRect();
        await kit.scrollRun(
          kit.scrollFor(rect),
          (shift) => besidePiece(moved(rect, shift)),
          { line: OFF_WE_GO[stepIndex % OFF_WE_GO.length] },
        );
        await kit.travelTo(besidePiece(element.getBoundingClientRect()), pace);
        return true;
      };

      const rip = async (step: PlanStep) => {
        const node = contentTree.get(step.source);
        if (!node || !element) return;
        const rect = element.getBoundingClientRect();
        setCat({ pose: "unstitch", flip: false, say: step.line || null });
        element.classList.add("ldg-torn");
        const block = cutBlock(node, step.excerpt);
        flying = {
          id: `${input.buildId}-${stepIndex}`,
          block,
          width:
            slotRef.current?.getBoundingClientRect().width ??
            Math.min(272, window.innerWidth - 32),
          source: step.source,
          excerpt: step.excerpt,
        };
        setFlight(flying);
        kit.say(
          `✂ rip ${step.source}${step.excerpt ? ` · “${step.excerpt}”` : ""}`,
          "warn",
        );
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
            { opacity: 1, scale: 1, rotate: [-6, 4, -3] },
            { duration: 0.35 },
          );
        }
        addFx("fx-dust", { x: rect.left + 24, y: rect.top + 12 }, "RIIIP!");
        await kit.wait(380);
      };

      const toss = async () => {
        const flyer = flightRef.current;
        setCat({ pose: "toss", body: "lgr-kick", say: "Nope!" });
        kit.say("✗ toss: not the answer", "bad");
        await kit.wait(220);
        if (flyer) {
          const away = position.current.x > window.innerWidth / 2 ? -1 : 1;
          await animate(
            flyer,
            {
              x: away > 0 ? window.innerWidth + 80 : -480,
              y: -320,
              rotate: away * 720,
              opacity: 0,
            },
            { duration: reduceMotion ? 0.15 : 0.85, ease: [0.3, 0, 0.6, 1] },
          );
        }
        element?.classList.remove("ldg-torn");
        setFlight(null);
        flying = null;
        addFx("fx-dust", kit.feet(position.current), "NOPE!");
        await kit.wait(300);
      };

      /** Shoves the block up the page to the Stack, the page scrolling under him. */
      const push = async (pace: Pace) => {
        const slot = slotRef.current;
        if (!slot || !flying) return;
        kit.say("↑ push to the stack", "info");
        const height = flightRef.current?.offsetHeight ?? 120;
        /* Behind the slot with the block out in front: left of it, or under it with no room. */
        const behind = (slotBox: DOMRect): Point =>
          slotBox.left > w * 0.8
            ? { x: slotBox.left - w * 0.92, y: slotBox.top + height - h * 0.94 }
            : {
                x: slotBox.left + slotBox.width / 2 - w / 2,
                y: slotBox.top + height + 4,
              };
        let target = slot.getBoundingClientRect();
        const open =
          target.top >= HEADER && target.bottom <= kit.stageBottom() - 8;
        if (!open) {
          const from = target;
          await kit.scrollRun(
            kit.scrollFor(from, 0.15),
            (shift) => behind(moved(from, shift)),
            {
              pushing: true,
              line: OFF_WE_GO[stepIndex % OFF_WE_GO.length],
            },
          );
          target = slot.getBoundingClientRect();
        }
        await kit.travelTo(behind(target), pace, { pushing: true });
        const flyer = flightRef.current;
        target = slot.getBoundingClientRect();
        if (flyer) {
          if (!reduceMotion) {
            setCat({ pose: "run", flip: false, body: "lgr-launch" });
            addFx("fx-dust", kit.feet(position.current), "SHOVE!");
          }
          await animate(
            flyer,
            { x: target.left, y: target.top, rotate: 0, scale: 1 },
            { type: "spring", stiffness: 320, damping: 18 },
          );
        }
        kit.check();
      };

      const stack = async () => {
        const slot = slotRef.current?.getBoundingClientRect();
        setCat({ pose: "stamp", flip: false, body: "lgr-land" });
        await kit.wait(220);
        if (flying) {
          input.onStack({
            id: flying.id,
            source: flying.source,
            excerpt: flying.excerpt,
            block: flying.block,
          });
          stacked++;
          kit.say(`■ stacked #${stacked} ${flying.source}`, "ok");
        }
        setFlight(null);
        flying = null;
        if (slot) {
          addFx(
            "fx-ring",
            { x: slot.left + slot.width / 2, y: slot.top + 24 },
            "",
          );
          addFx(
            "fx-dust",
            { x: slot.left + slot.width / 2, y: slot.top + 20 },
            "STACKED!",
          );
        }
        kit.shake();
        await kit.wait(380);
      };

      /** Kicks every section of the page copy off the screen, one boot each. */
      const kick = async () => {
        const sections = [
          ...(copyRef.current?.children ?? []),
        ] as HTMLElement[];
        const stackBox = stackRef.current?.getBoundingClientRect();
        if (!stackBox || sections.length === 0) return;
        kit.say(`⤳ kicking ${sections.length} sections off the page`, "info");
        const visible = kit.stageBottom() - HEADER;
        const lane = Math.max(stackBox.left + 8, 8);
        await kit.scrollRun(
          window.scrollY + stackBox.bottom - HEADER - visible * 0.4,
          (shift) => ({ x: lane, y: stackBox.bottom - shift - h * 0.9 }),
          { line: "Now for the rest…" },
        );
        const edge = () =>
          stackRef.current?.getBoundingClientRect().bottom ?? 0;
        await kit.travelTo({ x: lane, y: edge() - h * 0.9 }, "dash");
        for (const [index, section] of sections.entries()) {
          kit.check();
          const rect = section.getBoundingClientRect();
          const away = index % 2 === 0 ? 1 : -1;
          setCat({
            pose: "toss",
            flip: away < 0,
            body: "lgr-kick",
            say: index === 0 ? "Don't need these!" : null,
          });
          kit.say(
            `  kick ${section.id || section.getAttribute("aria-label") || section.tagName.toLowerCase()}`,
            "muted",
          );
          await kit.wait(160);
          addFx(
            "fx-dust",
            {
              x: position.current.x + w * (away > 0 ? 0.9 : 0.1),
              y: Math.max(rect.top, HEADER) + 40,
            },
            KICKS[index % KICKS.length],
          );
          section.classList.add("ldg-kicked");
          const duration = reduceMotion ? 1 : 650;
          kicked.current.push(
            section.animate(
              [
                { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
                {
                  transform: `translate(${away * window.innerWidth * 1.1}px, -${Math.round(window.innerHeight * 0.4)}px) rotate(${away * 28}deg)`,
                  opacity: 0,
                },
              ],
              { duration, easing: "cubic-bezier(.3,0,.7,1)", fill: "forwards" },
            ),
            section.animate(
              [{ height: `${rect.height}px` }, { height: "0px" }],
              {
                duration,
                delay: duration * 0.35,
                easing: "ease-in-out",
                fill: "forwards",
              },
            ),
          );
          kit.shake();
          await kit.wait(reduceMotion ? 20 : 520);
        }
        setCat({ pose: "idle", flip: false, body: "lgr-land", say: null });
        await kit.wait(400);
      };

      /** The Stack becomes sentences: he writes each one, pen in paw. */
      const write = async () => {
        setCat({
          pose: "conduct",
          flip: false,
          say: "Now to make it read right…",
        });
        kit.say("✎ writing it up", "info");
        const sentences = await input.writeup();
        kit.check();
        input.onWrite(sentences);
        kit.say(
          `  ${sentences.length} sentences · ${stacked} sources float off`,
          "muted",
        );
        window.scrollTo({
          top: 0,
          behavior: reduceMotion ? "instant" : "smooth",
        });
        await kit.wait(900);
        for (const [index, sentence] of sentences.entries()) {
          const caret = () =>
            document
              .querySelector(`[data-sentence="${index}"] [data-caret]`)
              ?.getBoundingClientRect();
          /* Pen to the caret: he stands on the line he is writing. */
          const atPen = (rect: DOMRect): Point => ({
            x: rect.left - w * 0.8,
            y: rect.top - h * 0.8,
          });
          kit.say(
            `  sentence ${index + 1}${sentence.cites.length ? ` · cites ${sentence.cites.map((cite) => `[${cite}]`).join("")}` : ""}`,
            "muted",
          );
          const typing = typingMs(sentence.text);
          const first = caret();
          if (first && !reduceMotion) {
            await kit.travelTo(atPen(first), "dash");
            setCat({
              pose: "conduct",
              flip: false,
              body: "lgr-fix",
              say: null,
            });
            addFx("fx-ring", { x: first.left, y: first.top + 12 }, "");
          }
          input.onType(index + 1);
          const element = catRef.current;
          const ends = performance.now() + typing;
          while (performance.now() < ends) {
            await frame();
            kit.check();
            const pen = caret();
            if (!pen || !element || reduceMotion) continue;
            const to = atPen(pen);
            const next = {
              x: Math.min(Math.max(to.x, 4), kit.stageRight() - w - 4),
              y: Math.max(to.y, HEADER),
            };
            if (
              Math.hypot(
                next.x - position.current.x,
                next.y - position.current.y,
              ) < 6
            ) {
              continue;
            }
            position.current = next;
            await animate(element, next, { duration: 0.1, ease: "linear" });
          }
          const last = caret();
          if (last)
            addFx("fx-dust", { x: last.left, y: last.bottom - 8 }, "FIXED!");
          await kit.wait(120);
        }
        input.onSettle();
        setCat({ pose: "found", body: "lgr-backflip", say: null });
        addFx(
          "fx-tada",
          { x: position.current.x + w / 2, y: position.current.y },
          "TA-DA!",
        );
        kit.shake();
        await kit.wait(1250);
        await kit.goHome();
      };

      try {
        kit.show();
        kit.say(
          `$ ledger build${input.followUp ? " --follow-up" : ""}`,
          "info",
        );
        for (const beat of openingBeats(input.followUp)) {
          if (beat.type === "unstitch") await unstitch();
          else await rewind();
        }
        input.onBegin();
        setCat({ pose: "search", say: "Checking my ledger…" });
        // Measure nothing until the Stack is on the page and has pushed it down.
        await frame();
        await frame();

        for await (const step of input.steps) {
          kit.check();
          if (!contentTree.get(step.source)) continue;
          for (const beat of beatsForStep(step)) {
            if (beat.type === "run-to") {
              if (!(await runTo(beat.source, beat.pace))) break;
            } else if (beat.type === "rip") await rip(step);
            else if (beat.type === "toss") await toss();
            else if (beat.type === "push") await push(beat.pace);
            else if (beat.type === "stack") await stack();
          }
          stepIndex++;
          setCat({ pose: "search", say: null });
        }
        kit.check();

        input.onStacked();
        const closing = closingBeats(stacked);
        for (const beat of closing) {
          if (beat.type === "kick") await kick();
          else if (beat.type === "write") await write();
        }
        const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
        if (closing.length > 0) {
          kit.say(`✓ built in ${seconds}s`, "ok");
          return "written";
        }
        setCat({ pose: "confused", say: "Not on my ledger!" });
        kit.say(`✗ nothing on the site answers that (${seconds}s)`, "bad");
        await kit.wait(2400);
        await kit.goHome();
        return "not_found";
      } catch (error) {
        return caught(error);
      }
    },
    [addFx, reduceMotion, restore, setCat, stage],
  );

  /** Puts Ledger by the dock without a Build, e.g. when a stored session opens. */
  const settle = useCallback(
    async (pose: CatPose = "wave") => {
      const kit = stage();
      setFlight(null);
      await frame();
      await kit.jump(kit.home());
      kit.show();
      setCat({ pose, flip: false, rot: 0, say: null });
    },
    [setCat, stage],
  );

  const stop = useCallback(() => {
    generation.current++;
    setFlight(null);
  }, []);

  return {
    play,
    dock,
    settle,
    stop,
    restore,
    cat,
    size,
    flight,
    fx,
    prints,
    catRef,
    flightRef,
    slotRef,
    stackRef,
    copyRef,
    pageRef,
    dockRef,
  };
}
