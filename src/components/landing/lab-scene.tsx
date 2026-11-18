"use client";

import { AnimatePresence, motion } from "motion/react";
import { type MouseEvent, useRef, useState } from "react";
import { labFacts, sceneNumber } from "@/content/landing";
import { Cat, type CatPose } from "@/features/ledger/components/cat";
import { Rise } from "./reveal";
import { useTimers } from "./use-timers";

/** Old stamps make way for new ones past this many. */
const MAX_STAMPS = 7;

type Stamp = { id: number; x: number; y: number; rotate: number };

/** What the site is, in three facts, and a Meridian passport page to stamp. */
export function LabScene() {
  return (
    <section
      id="lab"
      aria-labelledby="lab-title"
      className="border-ink border-t-2 bg-morning-haze"
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow mb-6 text-ink-muted">
            {sceneNumber("lab")} · What is reljod.com
          </p>
          <h2
            id="lab-title"
            className="font-mono text-3xl leading-[1.12] font-bold uppercase sm:text-4xl"
          >
            A workshop, not a brochure.
          </h2>
          <Rise>
            <p className="mt-4 text-lg leading-relaxed">
              Reljod Labs is where I build AI for banks in the open, so you can
              try it instead of reading about it.
            </p>
          </Rise>
          <ol className="mt-8 space-y-4">
            {labFacts.map((fact, index) => (
              <li key={fact.title}>
                <Rise
                  delay={index * 0.08}
                  className="outline-box flex gap-4 bg-paper p-4 shadow-hard-md"
                >
                  <span className="font-mono text-2xl leading-none font-bold text-federal-blue">
                    {index + 1}
                  </span>
                  <span>
                    <span className="block font-mono font-bold uppercase">
                      {fact.title}
                    </span>
                    <span className="mt-1 block text-ink-muted">
                      {fact.body}
                    </span>
                  </span>
                </Rise>
              </li>
            ))}
          </ol>
        </div>

        <StampPage />
      </div>
    </section>
  );
}

function StampPage() {
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [pose, setPose] = useState<CatPose>("idle");
  const nextId = useRef(0);
  const timers = useTimers();

  function stamp(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    // A keyboard press has no pointer position: stamp somewhere on the page.
    const fromKeyboard = event.detail === 0;
    const x = fromKeyboard
      ? 20 + Math.random() * 60
      : ((event.clientX - box.left) / box.width) * 100;
    const y = fromKeyboard
      ? 20 + Math.random() * 60
      : ((event.clientY - box.top) / box.height) * 100;
    const next: Stamp = {
      id: nextId.current++,
      x: Math.min(82, Math.max(18, x)),
      y: Math.min(88, Math.max(12, y)),
      rotate: -18 + Math.random() * 26,
    };
    setStamps((current) => [...current, next].slice(-MAX_STAMPS));
    setPose("stamp");
    timers.later(() => setPose("idle"), 450);
  }

  return (
    <div className="relative mx-auto w-full max-w-md">
      <button
        type="button"
        onClick={stamp}
        aria-label="Stamp the Meridian passport page SPECIMEN"
        className="outline-box @container relative flex aspect-[4/5] w-full flex-col cursor-pointer overflow-hidden bg-marble text-left shadow-hard-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-federal-blue"
      >
        <span className="block bg-federal-blue px-[6cqw] py-[3cqw] font-mono text-[3.6cqw] font-bold tracking-[0.12em] text-paper">
          REPUBLIC OF MERIDIA
        </span>
        <span className="flex gap-[5cqw] p-[6cqw]">
          <span className="flex aspect-[4/5] w-[30cqw] shrink-0 items-end justify-center overflow-hidden border-[0.8cqw] border-ink bg-paper">
            <svg aria-hidden="true" viewBox="0 0 40 50" className="w-full">
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
                fill="#b23a2b"
                stroke="#14213d"
                strokeWidth="2"
              />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col gap-[2cqw] font-mono text-[3.4cqw] leading-tight">
            <Field label="Surname" value="NOBODY" />
            <Field label="Given names" value="ANY ONE" />
            <Field label="Nationality" value="MERIDIAN" />
            <Field label="Real person?" value="NO" />
          </span>
        </span>
        <span className="mx-[6cqw] block border-ink/30 border-t-2 pt-[4cqw] font-mono text-[2.8cqw] break-all text-ink-muted">
          P&lt;MDANOBODY&lt;&lt;ANY&lt;ONE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
          <br />
          0000000000MDA0000000&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
        </span>

        <AnimatePresence>
          {stamps.map((mark) => (
            <motion.span
              key={mark.id}
              aria-hidden="true"
              initial={{ opacity: 0, scale: 2.2 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="pointer-events-none absolute border-[0.9cqw] border-seal-red px-[2.4cqw] py-[0.6cqw] font-mono text-[7cqw] font-bold tracking-[0.1em] text-seal-red mix-blend-multiply"
              style={{
                left: `${mark.x}%`,
                top: `${mark.y}%`,
                translate: "-50% -50%",
                rotate: `${mark.rotate}deg`,
              }}
            >
              SPECIMEN
            </motion.span>
          ))}
        </AnimatePresence>
      </button>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 -bottom-10 w-28 sm:-right-10 sm:w-36 [&>svg]:h-auto [&>svg]:w-full"
      >
        <Cat pose={pose} size={240} />
      </div>
      <p className="mt-4 pr-24 text-sm text-ink-muted" aria-live="polite">
        {stamps.length === 0
          ? "Meridia isn't real, and neither is anyone in its paperwork. Tap the page to stamp it."
          : "Stamped. Every sample document on this site carries that word."}
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="block">
      <span className="block text-[2.4cqw] tracking-[0.1em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="block font-bold">{value}</span>
    </span>
  );
}
