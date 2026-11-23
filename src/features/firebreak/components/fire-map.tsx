"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { heat as heatOf } from "../domain/engine";
import {
  alight,
  type Burn,
  burnOf,
  HEX,
  HEXES,
  hexPoints,
  MAP_RADIUS,
  seatOf,
  wedgeSize,
} from "../domain/map";
import type { GaugeId, Gauges, Scenario } from "../domain/scenario";
import { Counter } from "./counter";

const FILL: Record<Burn, string> = {
  calm: "#f5f1e8",
  warm: "#d9a84e",
  flame: "#b23a2b",
  char: "#2b211c",
};

const STROKE: Record<Burn, string> = {
  calm: "#e4dccb",
  warm: "#b88a36",
  flame: "#e0644f",
  char: "#3d2f27",
};

const POINTS = hexPoints();
const EXTENT = HEX * 1.5 * MAP_RADIUS + 64;
const VIEW = `${-EXTENT * 1.18} ${-EXTENT} ${EXTENT * 2.36} ${EXTENT * 2}`;

/** A flame drawn over a burning hex: two tongues, flickering at their own pace. */
function Flame({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y + 4})`}>
      <path
        className="fb-flame"
        style={{ animationDelay: `${delay}ms` }}
        d="M0 0 C-5 -3 -4 -9 -1 -13 C0 -9 3 -9 2 -14 C6 -10 6 -3 0 0 Z"
        fill="#d9a84e"
      />
      <path
        className="fb-flame"
        style={{
          animationDelay: `${delay + 260}ms`,
          animationDuration: "0.7s",
        }}
        d="M0 0 C-2.5 -2 -2 -5 0 -8 C2 -5 2.5 -2 0 0 Z"
        fill="#fff3d6"
      />
      <circle
        className="fb-ember"
        style={{ animationDelay: `${delay}ms` }}
        cx="2"
        cy="-14"
        r="0.9"
        fill="#d9a84e"
      />
    </g>
  );
}

/**
 * The company in the middle, six Stakeholders around it, and a fire that eats
 * each wedge from the rim inwards as that Stakeholder's standing falls. When a
 * decision brings a Gauge back, the hexes it saves flash blue as they are put
 * out. Every number on the map comes from the Engine.
 */
export function FireMap({
  scenario,
  gauges,
  round,
  speaking,
  delta,
}: {
  scenario: Scenario;
  gauges: Gauges;
  /** Changes every Round, so the douse and catch flashes replay. */
  round: number;
  speaking: GaugeId | null;
  delta: Gauges | null;
}) {
  const burns = useMemo(() => {
    const lit: Partial<Record<GaugeId, number>> = {};
    return HEXES.map((hex) => {
      if (!hex.gauge) return "calm" as Burn;
      lit[hex.gauge] ??= alight(gauges[hex.gauge], wedgeSize(hex.gauge));
      return burnOf(hex.order, lit[hex.gauge] ?? 0);
    });
  }, [gauges]);

  // When a Round lands, the hexes it put out flash blue and the ones it set
  // alight flash white. Derived during render, so the flashes last the Round.
  const [flash, setFlash] = useState(() => ({
    round,
    burns,
    doused: new Set<number>(),
    caught: new Set<number>(),
  }));
  if (flash.round !== round) {
    const doused = new Set<number>();
    const caught = new Set<number>();
    burns.forEach((burn, index) => {
      const was = flash.burns[index] ?? burn;
      const hot = (b: Burn) => b === "flame" || b === "char";
      if (hot(was) && !hot(burn)) doused.add(index);
      if (!hot(was) && hot(burn)) caught.add(index);
    });
    setFlash({ round, burns, doused, caught });
  }

  const heat = heatOf(gauges);
  const hqHot = heat > 45;

  return (
    <div
      className="fb-table relative overflow-hidden rounded-sm outline-box"
      style={{ ["--fb-glow" as string]: Math.min(0.55, heat / 90).toFixed(2) }}
    >
      <svg
        viewBox={VIEW}
        className="block h-auto max-h-[min(58vh,520px)] w-full"
        role="img"
        aria-label={`Fire map. Heat ${Math.round(heat)} of 100.`}
      >
        <defs>
          <filter id="fb-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {HEXES.map((hex, index) => {
          const burn = burns[index] as Burn;
          const doused = flash.round === round && flash.doused.has(index);
          const caught = flash.round === round && flash.caught.has(index);
          const delay = hex.order * 45;
          if (!hex.gauge)
            return (
              <g
                key={`${hex.q},${hex.r}`}
                transform={`translate(${hex.x} ${hex.y})`}
              >
                {hqHot ? (
                  <polygon
                    className="fb-hq-ring"
                    points={POINTS}
                    fill="none"
                    stroke="#b23a2b"
                    strokeWidth="2"
                  />
                ) : null}
                <polygon
                  points={hexPoints(HEX + 1.5)}
                  fill="#ffffff"
                  stroke={hqHot ? "#b23a2b" : "#14213d"}
                  strokeWidth="2"
                />
                <text
                  textAnchor="middle"
                  dy="3.2"
                  className="font-mono"
                  fontSize="8"
                  fontWeight="700"
                  fill="#14213d"
                >
                  {scenario.company
                    .split(/\s+/)
                    .map((word) => word[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </text>
              </g>
            );
          return (
            <g
              key={`${hex.q},${hex.r}`}
              transform={`translate(${hex.x} ${hex.y})`}
            >
              <polygon
                className="fb-hex"
                points={POINTS}
                fill={FILL[burn]}
                stroke={STROKE[burn]}
                strokeWidth="1"
                style={{ transitionDelay: `${delay}ms` }}
              />
              {doused ? (
                <motion.polygon
                  key={`douse-${round}`}
                  points={POINTS}
                  fill="#6fa0dc"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.95, 0] }}
                  transition={{ duration: 1.4, delay: delay / 1000 + 0.2 }}
                />
              ) : null}
              {caught ? (
                <motion.polygon
                  key={`catch-${round}`}
                  points={POINTS}
                  fill="#fff3d6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.9, 0] }}
                  transition={{ duration: 0.9, delay: delay / 1000 }}
                />
              ) : null}
              {burn === "char" ? (
                <circle r="1.3" fill="#b23a2b" opacity="0.8" />
              ) : null}
            </g>
          );
        })}

        <g filter="url(#fb-glow)">
          {HEXES.map((hex, index) =>
            burns[index] === "flame" ? (
              <Flame
                key={`f${hex.q},${hex.r}`}
                x={hex.x}
                y={hex.y}
                delay={(hex.q * 137 + hex.r * 71) % 700}
              />
            ) : null,
          )}
        </g>

        {scenario.stakeholders.map((person) => {
          const seat = seatOf(person.gauge);
          const change = delta?.[person.gauge] ?? 0;
          const value = gauges[person.gauge];
          const talking = speaking === person.gauge;
          const anchor =
            Math.abs(seat.x) < 20 ? "middle" : seat.x > 0 ? "start" : "end";
          const nudge = anchor === "start" ? -8 : anchor === "end" ? 8 : 0;
          return (
            <g
              key={person.gauge}
              transform={`translate(${seat.x + nudge} ${seat.y})`}
              data-testid={`fb-seat-${person.gauge}`}
            >
              {talking ? (
                <motion.circle
                  r="13"
                  fill="none"
                  stroke="#d9a84e"
                  strokeWidth="1.5"
                  initial={{ scale: 0.8, opacity: 1 }}
                  animate={{ scale: 1.6, opacity: 0 }}
                  transition={{ duration: 1.1, repeat: Infinity }}
                />
              ) : null}
              <circle
                r="11"
                fill={talking ? "#d9a84e" : "#ffffff"}
                stroke="#14213d"
                strokeWidth="2"
              />
              <text
                textAnchor="middle"
                dy="3"
                fontSize="7.5"
                fontWeight="700"
                className="font-mono"
                fill="#14213d"
              >
                {person.initials}
              </text>
              <text
                x={anchor === "middle" ? 0 : anchor === "start" ? 16 : -16}
                y={anchor === "middle" ? (seat.y < 0 ? -18 : 24) : -2}
                textAnchor={anchor}
                fontSize="7"
                fill="#f5f1e8"
                fontWeight="600"
              >
                {person.name}
              </text>
              <text
                x={anchor === "middle" ? 0 : anchor === "start" ? 16 : -16}
                y={anchor === "middle" ? (seat.y < 0 ? -9 : 33) : 8}
                textAnchor={anchor}
                fontSize="8"
                className="font-mono"
                fontWeight="700"
                fill={
                  value < 40 ? "#e0644f" : value < 60 ? "#d9a84e" : "#d6e4f5"
                }
              >
                <Counter value={value} />
                {change !== 0 ? (
                  <tspan
                    key={`${round}-${person.gauge}`}
                    fill={change > 0 ? "#6fa0dc" : "#e0644f"}
                    fontSize="6.5"
                  >
                    {` ${change > 0 ? "▲" : "▼"}${Math.abs(change)}`}
                  </tspan>
                ) : null}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute top-2 left-3 eyebrow text-[10px] text-limestone/80">
        Fire map · the rim burns first
      </div>
    </div>
  );
}
