"use client";

import { motion } from "motion/react";
import { Button } from "@/features/harness/components/ui";
import { HEXES, hexPoints } from "../domain/map";
import { SCENARIOS } from "../domain/scenarios";
import type { Mode } from "./use-drill";

const EMBERS = Array.from({ length: 26 }, (_, index) => ({
  left: (index * 37) % 100,
  delay: (index * 0.61) % 7,
  duration: 5 + ((index * 13) % 5),
  drift: ((index * 29) % 60) - 30,
  size: 2 + (index % 3),
}));

/** A slow-burning hex field behind the title: the map, before anything has happened. */
function Field() {
  return (
    <svg
      viewBox="-90 -80 180 160"
      className="absolute inset-0 h-full w-full opacity-60"
      aria-hidden="true"
    >
      {HEXES.map((hex) => (
        <motion.polygon
          key={`${hex.q},${hex.r}`}
          points={hexPoints()}
          transform={`translate(${hex.x} ${hex.y})`}
          fill={hex.gauge ? "#1f2d4d" : "#b23a2b"}
          stroke="#2c3c60"
          strokeWidth="0.8"
          initial={{ opacity: 0 }}
          animate={{
            opacity: hex.ring === 4 && hex.order % 3 === 0 ? [0.5, 1, 0.5] : 1,
          }}
          transition={{
            delay: hex.ring * 0.12,
            duration: hex.ring === 4 ? 3 + (hex.order % 4) : 0.6,
            repeat: hex.ring === 4 && hex.order % 3 === 0 ? Infinity : 0,
          }}
          style={
            hex.ring === 4 && hex.order % 3 === 0
              ? { fill: "#6b2a20" }
              : undefined
          }
        />
      ))}
    </svg>
  );
}

/**
 * The way in: a dark table, embers rising, and three companies on their worst
 * morning. Take the chair (the model plays the Room) or watch a recorded
 * drill (no model, no cost).
 */
export function Lobby({
  onStart,
  model,
  left,
}: {
  onStart: (scenario: string, mode: Mode) => void;
  model: string | null;
  left: number | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-sm border-2 border-ink bg-ink px-5 py-10 text-paper shadow-hard-md sm:px-10 sm:py-14">
        <Field />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-full"
          aria-hidden="true"
        >
          {EMBERS.map((ember, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of decorative embers.
              key={index}
              className="fb-lobby-ember absolute bottom-0 rounded-full bg-brass opacity-0"
              style={{
                left: `${ember.left}%`,
                width: ember.size,
                height: ember.size,
                ["--fb-delay" as string]: `${ember.delay}s`,
                ["--fb-dur" as string]: `${ember.duration}s`,
                ["--fb-drift" as string]: `${ember.drift}px`,
              }}
            />
          ))}
        </div>
        <div className="relative max-w-2xl">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="eyebrow text-brass"
          >
            A crisis drill for the people at the top
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, letterSpacing: "0.4em" }}
            animate={{ opacity: 1, letterSpacing: "0.06em" }}
            transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
            className="mt-2 font-mono text-5xl font-black uppercase sm:text-7xl"
          >
            Firebreak
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-4 text-lg leading-snug text-limestone sm:text-xl"
          >
            Seventy-two hours. Six people who need an answer. You have the
            chair.
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="mt-3 max-w-xl text-sm leading-relaxed text-limestone/80"
          >
            Decide, in a click or in your own words. {model ?? "Qwen4-Max"}{" "}
            plays the room: the regulator, the press, your staff, your board.
            Code keeps the score, the clock and the law. At the end, a public
            Statement is drafted and sent back until it is fit to publish.
          </motion.p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {SCENARIOS.map((scenario, index) => (
          <motion.article
            key={scenario.id}
            initial={{
              opacity: 0,
              y: 30,
              rotate: index === 1 ? 0 : index === 0 ? -1.5 : 1.5,
            }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.3 + index * 0.15,
              type: "spring",
              stiffness: 180,
              damping: 20,
            }}
            whileHover={{ y: -4, rotate: 0 }}
            className="group relative flex flex-col rounded-sm border-2 border-ink bg-paper p-4 shadow-hard-md"
            data-testid={`fb-scenario-${scenario.id}`}
          >
            <span className="absolute -top-3 right-3 -rotate-6 rounded-sm border-2 border-seal-red bg-paper px-2 font-mono text-xs font-bold tracking-widest text-seal-red uppercase transition-transform group-hover:rotate-0">
              {scenario.title}
            </span>
            <p className="eyebrow text-ink-muted">{scenario.industry}</p>
            <h2 className="mt-1 text-2xl font-bold text-ink">
              {scenario.company}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-snug text-ink">
              {scenario.logline}
            </p>
            <p className="mt-3 font-mono text-[11px] text-ink-muted">
              Starts {scenario.startsAt} · {scenario.slots.length} Rounds ·{" "}
              {scenario.rules.length} Rules
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => onStart(scenario.id, "live")}
                disabled={left === 0}
                data-testid={`fb-start-${scenario.id}`}
              >
                Take the chair
              </Button>
              <Button
                onClick={() => onStart(scenario.id, "recorded")}
                data-testid={`fb-watch-${scenario.id}`}
              >
                Watch it played
              </Button>
            </div>
          </motion.article>
        ))}
      </div>
      <p className="text-xs text-ink-muted">
        Every company, person, law and number is fictional (the Republic of
        Meridia; florin are play money). A live drill is about a dozen model
        calls, roughly ten cents.
        {left !== null ? ` You have ${left} Rounds left this hour.` : ""}
      </p>
    </div>
  );
}
