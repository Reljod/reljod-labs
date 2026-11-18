"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import {
  type LensFindingId,
  lensFindings,
  sceneNumber,
} from "@/content/landing";
import "./landing.css";
import { clampUnit, lensTouches } from "./lens";
import { Rise } from "./reveal";

/** The lens is 26% of the stage wide; it finds what is under its glass, not its rim. */
const LENS_SIZE = 0.26;
const GLASS_RADIUS = LENS_SIZE * 0.32;
const START = { x: 0.17, y: 0.2 };

/** A plain explainer of what the AI does, played as a game: find what's wrong with a customer's papers. */
export function LensScene() {
  const reduce = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState(START);
  const [dragging, setDragging] = useState(false);
  const [found, setFound] = useState<LensFindingId[]>([]);
  const allFound = found.length === lensFindings.length;

  // Whatever the glass is over counts as found.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    const glass = {
      x: lens.x * box.width,
      y: lens.y * box.height,
      r: GLASS_RADIUS * box.width,
    };
    const hits = new Set<LensFindingId>();
    for (const spot of stage.querySelectorAll<HTMLElement>("[data-spot]")) {
      const rect = spot.getBoundingClientRect();
      const touched = lensTouches(glass, {
        left: rect.left - box.left,
        top: rect.top - box.top,
        width: rect.width,
        height: rect.height,
      });
      if (touched) hits.add(spot.dataset.spot as LensFindingId);
    }
    if (hits.size === 0) return;
    setFound((current) => {
      const added = [...hits].filter((id) => !current.includes(id));
      return added.length ? [...current, ...added] : current;
    });
  }, [lens]);

  function moveTo(clientX: number, clientY: number) {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return;
    setLens({
      x: clampUnit((clientX - box.left) / box.width),
      y: clampUnit((clientY - box.top) / box.height),
    });
  }

  function grab(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function drag(event: PointerEvent<HTMLButtonElement>) {
    if (dragging) moveTo(event.clientX, event.clientY);
  }
  function drop() {
    setDragging(false);
  }

  /** A tap anywhere on the papers sends the lens there. */
  function onStageClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-lens]"))
      return;
    moveTo(event.clientX, event.clientY);
  }

  /** The keyboard route: each suspicious spot is a button that brings the lens to it. */
  function inspect(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    moveTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function reset() {
    setFound([]);
    setLens(START);
  }

  const spot = (id: LensFindingId, label: string, children: ReactNode) => (
    <Spot
      id={id}
      label={label}
      number={found.indexOf(id) + 1}
      onInspect={inspect}
    >
      {children}
    </Spot>
  );

  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="border-ink border-t-2 bg-paper"
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <p className="eyebrow mb-6 text-ink-muted">
            {sceneNumber("how")} · What the AI does
          </p>
          <h2
            id="how-title"
            className="font-mono text-3xl leading-[1.12] font-bold uppercase sm:text-4xl"
          >
            It reads the boring pages, closely.
          </h2>
          <Rise className="mt-6 space-y-4 text-lg leading-relaxed">
            <p>
              Before a bank opens an account, someone checks that a customer's
              ID and a bill agree. It's slow work, and tired eyes miss things.
            </p>
            <p className="font-semibold">
              Your turn: drag the magnifier over the papers, or tap where
              something looks off. Three things are wrong.
            </p>
          </Rise>

          <ol className="mt-8 space-y-3" aria-live="polite">
            {lensFindings.map((finding, index) => {
              const shown = found.includes(finding.id);
              return (
                <li key={finding.id} className="flex items-start gap-3">
                  <span
                    className={`outline-box flex size-7 shrink-0 items-center justify-center font-mono text-sm font-bold ${shown ? "bg-seal-red text-paper" : "bg-limestone text-ink-muted"}`}
                  >
                    {shown ? found.indexOf(finding.id) + 1 : "?"}
                  </span>
                  <span className={shown ? "" : "text-ink-muted"}>
                    {shown
                      ? finding.label
                      : `Problem ${index + 1}: not found yet`}
                  </span>
                </li>
              );
            })}
          </ol>

          <AnimatePresence mode="wait" initial={false}>
            {allFound ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="outline-box mt-8 bg-morning-haze p-5 shadow-hard-md"
              >
                <p className="font-semibold">
                  That's the job. Now picture it for every customer, every day.
                </p>
                <p className="mt-2 text-ink-muted">
                  The AI doesn't get tired. It boxes what it finds on the page,
                  and a person makes the call.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <ButtonLink href="/demos/document-compliance">
                    Try the real one
                    <Icon name="arrow" size={18} />
                  </ButtonLink>
                  <button
                    type="button"
                    onClick={reset}
                    className="eyebrow outline-box press rounded-sm bg-paper px-4 font-bold"
                  >
                    Play again
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="show"
                type="button"
                exit={{ opacity: 0 }}
                onClick={() =>
                  setFound((current) => [
                    ...current,
                    ...lensFindings
                      .map((finding) => finding.id)
                      .filter((id) => !current.includes(id)),
                  ])
                }
                className="eyebrow mt-6 text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Just show me
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: tapping the papers is a shortcut; each spot is also a button that brings the lens to it. */}
        <div
          ref={stageRef}
          onClick={onStageClick}
          className="@container relative mx-auto aspect-square w-full max-w-xl cursor-crosshair select-none"
        >
          {/* The bill. */}
          <div
            className="outline-box absolute flex flex-col gap-[1.4cqw] overflow-hidden bg-paper p-[3.4cqw] shadow-hard-md"
            style={{
              left: "36cqw",
              top: "4cqw",
              width: "58cqw",
              height: "82cqw",
              rotate: "2deg",
            }}
          >
            <Watermark />
            <p className="font-mono text-[2.6cqw] font-bold tracking-[0.08em]">
              MERIDIA WATER &amp; LIGHT
            </p>
            <p className="text-[2.2cqw] text-ink-muted">Statement · Oct 2026</p>
            <p className="mt-[2cqw] font-mono text-[2cqw] text-ink-muted uppercase">
              Bill to
            </p>
            <p className="text-[3.4cqw] leading-tight font-bold">
              {spot("name", "the name on the bill", "Amara T. Quizon")}
            </p>
            <p className="text-[2.6cqw] leading-snug">
              {spot("address", "the address on the bill", "21 Lantern Street")}
              <br />
              Port Selene, Meridia
            </p>
            <div className="mt-auto ml-auto w-[26cqw] space-y-[1cqw] text-[2.4cqw]">
              <p className="flex justify-between border-ink/30 border-b">
                <span>Water</span>
                <span>24.10</span>
              </p>
              <p className="flex justify-between border-ink/30 border-b">
                <span>Light</span>
                <span>61.85</span>
              </p>
              <p className="flex justify-between font-bold">
                <span>Due</span>
                <span>M$ 85.95</span>
              </p>
            </div>
          </div>

          {/* The ID card. */}
          <div
            className="outline-box absolute flex flex-col overflow-hidden bg-morning-haze shadow-hard-lg"
            style={{
              left: "3cqw",
              top: "50cqw",
              width: "60cqw",
              height: "38cqw",
              rotate: "-3deg",
            }}
          >
            <Watermark />
            <p className="bg-ink px-[2cqw] py-[1cqw] font-mono text-[2cqw] font-bold tracking-[0.08em] text-paper">
              REPUBLIC OF MERIDIA · IDENTITY CARD
            </p>
            <div className="flex flex-1 gap-[3cqw] p-[2.6cqw]">
              <Portrait />
              <div className="flex min-w-0 flex-col gap-[1.2cqw]">
                <p className="text-[3.2cqw] leading-tight font-bold">
                  {spot("name", "the name on the ID card", "QUISON, AMARA T.")}
                </p>
                <p className="text-[2.3cqw] leading-snug">
                  {spot(
                    "address",
                    "the address on the ID card",
                    "12 Lantern Street",
                  )}
                  <br />
                  Port Selene
                </p>
                <p className="mt-auto text-[2.3cqw]">
                  {spot(
                    "expiry",
                    "the expiry date on the ID card",
                    "Expires 14 AUG 2026",
                  )}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            data-lens
            aria-label="Magnifier. Drag it over the papers."
            tabIndex={-1}
            onPointerDown={grab}
            onPointerMove={drag}
            onPointerUp={drop}
            onPointerCancel={drop}
            className={`absolute z-10 cursor-grab touch-none active:cursor-grabbing ${dragging || reduce ? "" : "transition-[left,top] duration-300 ease-out"}`}
            style={{
              left: `${lens.x * 100}%`,
              top: `${lens.y * 100}%`,
              width: `${LENS_SIZE * 100}cqw`,
              height: `${LENS_SIZE * 100}cqw`,
              translate: "-50% -50%",
            }}
          >
            <span className="absolute top-[78%] left-[78%] h-[14cqw] w-[4.4cqw] origin-top -rotate-45 rounded-sm border-[0.6cqw] border-ink bg-brass" />
            <span className="absolute inset-0 rounded-full border-[1cqw] border-ink bg-clear-sky/15 shadow-hard-md backdrop-saturate-150" />
            {found.length === 0 && !dragging ? (
              <span className="landing-nudge absolute -top-[6cqw] left-1/2 -translate-x-1/2 font-mono text-[2.6cqw] font-bold whitespace-nowrap text-federal-blue">
                drag me
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Something on the papers worth a closer look: a button for keyboards, and a red box once it is found. */
function Spot({
  id,
  label,
  number,
  onInspect,
  children,
}: {
  id: LensFindingId;
  label: string;
  /** Its place in the found list, or 0 while it is still hidden. */
  number: number;
  onInspect: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-spot={id}
      onClick={onInspect}
      aria-label={`Look closer at ${label}`}
      className="relative inline cursor-crosshair rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue"
    >
      {children}
      <AnimatePresence>
        {number > 0 ? (
          <motion.span
            aria-hidden="true"
            initial={{ opacity: 0, scale: 1.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute -inset-x-[0.8cqw] -inset-y-[0.5cqw] border-[0.5cqw] border-seal-red bg-seal-red/10"
          >
            <span className="absolute -top-[2.4cqw] -right-[2.4cqw] flex size-[4cqw] items-center justify-center rounded-full bg-seal-red font-mono text-[2.4cqw] font-bold text-paper">
              {number}
            </span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );
}

function Watermark() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[9cqw] font-bold tracking-[0.1em] text-seal-red/10 -rotate-[24deg]"
    >
      SPECIMEN
    </span>
  );
}

/** The card's photo: a person drawn in two shapes. */
function Portrait() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 50"
      className="h-[22cqw] w-auto shrink-0 border-[0.5cqw] border-ink bg-paper"
    >
      <circle
        cx="20"
        cy="19"
        r="9"
        fill="#d9a84e"
        stroke="#14213d"
        strokeWidth="2"
      />
      <path
        d="M4 50 C 6 36, 34 36, 36 50"
        fill="#1d4e89"
        stroke="#14213d"
        strokeWidth="2"
      />
    </svg>
  );
}
